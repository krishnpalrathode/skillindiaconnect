import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  ServiceUnavailableException,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { OtpPurpose, UserStatus } from '@prisma/client';
import { Request, Response } from 'express';
import { Public } from '../decorators/public.decorator';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';
import { TokenService } from '../token.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { OtpService } from './otp.service';
import { CandidateReadService } from '../../candidate/candidate-read.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { PhoneLoginStartDto } from './dto/phone-login-start.dto';
import { PhoneLoginVerifyDto } from './dto/phone-login-verify.dto';

const REFRESH_COOKIE = 'sic_refresh';

@Controller('auth')
export class OtpController {
  constructor(
    private readonly otpService: OtpService,
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService,
    private readonly candidateReadService: CandidateReadService,
  ) {}

  // ─── Verification (onboarding) ────────────────────────────────────────────

  /**
   * Send a PHONE_VERIFY OTP to the given number.
   *
   * ENUMERATION-SAFE FOR ANONYMOUS CALLERS: for an unauthenticated request this
   * performs NO account lookup — outcomes describe WhatsApp/the provider, never
   * whether an account exists. (409 PHONE_NOT_ON_WHATSAPP is pre-existing.)
   *
   * DUPLICATE GUARD FOR AUTHENTICATED CALLERS (onboarding): if a logged-in
   * candidate enters a number already verified by ANOTHER candidate, we reject
   * BEFORE spending an OTP send (PHONE_ALREADY_IN_USE) — the same rule the verify
   * step enforces, moved earlier for a better UX. This is surfaced only to the
   * authenticated caller and excludes their own number, so it is not a public
   * enumeration oracle.
   */
  @Public()
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async sendOtp(@Body() dto: SendOtpDto, @Req() req: Request) {
    const ip = req.ip ?? '0.0.0.0';

    const currentUserId = this.tryGetCurrentUserId(req);
    if (currentUserId) {
      const taken = await this.prisma.candidateProfile.findFirst({
        where: {
          phone: dto.phone,
          phoneVerifiedAt: { not: null },
          NOT: { userId: currentUserId },
        },
        select: { userId: true },
      });
      if (taken) {
        throw new ConflictException({ code: 'PHONE_ALREADY_IN_USE' });
      }
    }

    const { outcome } = await this.otpService.issue(dto.phone, OtpPurpose.PHONE_VERIFY, ip);

    if (outcome === 'NOT_ON_WHATSAPP') {
      throw new ConflictException({ code: 'PHONE_NOT_ON_WHATSAPP' });
    }

    if (outcome === 'SEND_FAILED') {
      // CR-WA W1.5. This used to return `{ sent: true }`: during a provider
      // outage the user was shown "code sent", waited for a code that was never
      // dispatched, and had no way forward. 503 because the dependency is down
      // and a retry may well succeed; `fallbackAvailable` tells the UI it can
      // offer the email route instead of leaving the user on a dead end.
      throw new ServiceUnavailableException({
        code: 'OTP_SEND_FAILED',
        detail: "We couldn't send your code right now. Please try again, or continue with email.",
        meta: { fallbackAvailable: true },
      });
    }

    return { data: { sent: true } };
  }

  /**
   * Verify a PHONE_VERIFY OTP for the authenticated candidate.
   * On success: sets phoneVerifiedAt + whatsappCapable on the caller's profile.
   * The phone must not already be verified by a different candidate.
   */
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto, @CurrentUser() currentUser: CurrentUserPayload) {
    await this.otpService.verify(dto.phone, dto.otp, OtpPurpose.PHONE_VERIFY);

    // Reject if the phone is already claimed by another candidate.
    const existing = await this.prisma.candidateProfile.findFirst({
      where: {
        phone: dto.phone,
        phoneVerifiedAt: { not: null },
        NOT: { userId: currentUser.userId },
      },
      select: { userId: true },
    });
    if (existing) {
      throw new ConflictException({ code: 'PHONE_ALREADY_IN_USE' });
    }

    await this.prisma.candidateProfile.update({
      where: { userId: currentUser.userId },
      data: {
        phone: dto.phone,
        phoneVerifiedAt: new Date(),
        whatsappCapable: true,
      },
    });

    return { data: { phoneVerified: true, whatsappCapable: true } };
  }

  // ─── Phone login (candidates only) ───────────────────────────────────────

  /**
   * Initiate phone login.
   *
   * ENUMERATION-SAFE: always returns 200 with the SAME body regardless of
   * whether the phone belongs to a registered candidate. An OTP is issued only
   * when a verified CANDIDATE account exists.
   *
   * ⚠️ THE SEND OUTCOME IS DELIBERATELY SWALLOWED HERE (CR-WA W1.5), and this is
   * the one place it must be. A send is only ATTEMPTED for a registered number,
   * so any outcome-dependent response — including an honest "we couldn't send
   * it" — would turn this endpoint into an account-existence oracle: an attacker
   * would learn that a failure implies registration. That is a worse harm than
   * the ambiguity it would remove.
   *
   * The user is not left stranded: the response deliberately promises nothing
   * ("IF an account exists"), and the sign-in screen offers the email route
   * UNCONDITIONALLY — an affordance that is present for every caller and
   * therefore reveals nothing. Honesty is preserved in the delivery ledger
   * (whatsapp_messages FAILED) and in the logs, which are not attacker-visible.
   */
  @Public()
  @Post('login/phone/start')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async phoneLoginStart(@Body() dto: PhoneLoginStartDto, @Req() req: Request) {
    const ip = req.ip ?? '0.0.0.0';

    const candidate = await this.candidateReadService.findCandidateUserByVerifiedPhone(dto.phone);

    if (candidate) {
      // Issue a LOGIN OTP; notOnWhatsapp result is swallowed per spec.
      await this.otpService.issue(dto.phone, OtpPurpose.LOGIN, ip);
    } else {
      // No registered candidate — still apply the IP budget to prevent
      // timing-based enumeration (a found phone would also hit this).
      await this.otpService.applyIpBudget(ip);
    }

    return { data: { message: 'If an account exists, an OTP has been sent.' } };
  }

  /**
   * Complete phone login with a valid LOGIN OTP.
   * Candidates only. Suspended accounts → 403. Issues tokens via the unchanged
   * TokenService (same access token + refresh cookie rotation as email login).
   */
  @Public()
  @Post('login/phone/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async phoneLoginVerify(
    @Body() dto: PhoneLoginVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.otpService.verify(dto.phone, dto.otp, OtpPurpose.LOGIN);

    // Resolve the candidate user. CandidateReadService already filters for verified CANDIDATE.
    const resolved = await this.candidateReadService.findCandidateUserByVerifiedPhone(dto.phone);
    if (!resolved) {
      throw new UnauthorizedException({ code: 'INVALID_OTP' });
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: resolved.userId } });

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED' });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.tokenService.issue(
      user.id,
      user.email,
      user.role,
      req.ip,
      req.headers['user-agent'],
    );
    this.setRefreshCookie(res, tokens.refreshToken, tokens.refreshExp);

    return {
      data: {
        user: { id: user.id, email: user.email, role: user.role },
        accessToken: tokens.accessToken,
      },
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Best-effort caller identity on a @Public route: returns the userId from a
   * valid access token if present, else null. Used to gate the duplicate-phone
   * guard to authenticated (onboarding) callers without failing anonymous ones.
   */
  private tryGetCurrentUserId(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
      return this.tokenService.verifyAccess(header.slice(7)).sub;
    } catch {
      return null;
    }
  }

  private setRefreshCookie(res: Response, token: string, exp: number): void {
    const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';
    const isProd = nodeEnv !== 'development';
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/api/v1/auth',
      maxAge: exp * 1000 - Date.now(),
    });
  }
}
