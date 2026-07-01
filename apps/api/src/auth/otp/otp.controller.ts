import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
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
   * Enumeration-safe: 409 is only returned when the number is confirmed not on
   * WhatsApp (not to reveal account existence — there is no account lookup here).
   */
  @Public()
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async sendOtp(@Body() dto: SendOtpDto, @Req() req: Request) {
    const ip = req.ip ?? '0.0.0.0';
    const result = await this.otpService.issue(dto.phone, OtpPurpose.PHONE_VERIFY, ip);
    if (result.notOnWhatsapp) {
      throw new ConflictException({ code: 'PHONE_NOT_ON_WHATSAPP' });
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
   * ENUMERATION-SAFE: always returns 200 with the same body regardless of whether
   * the phone belongs to a registered candidate. An OTP is issued only when a
   * verified CANDIDATE account exists; notOnWhatsapp is swallowed in that case.
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
