import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService, GoogleUser } from './auth.service';
import { TokenService } from './token.service';
import { GoogleGuard } from './guards/google.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser, CurrentUserPayload } from './decorators/current-user.decorator';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { PasswordResetService } from './password-reset.service';

const REFRESH_COOKIE = 'sic_refresh';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  // ─── Signup ──────────────────────────────────────────────────────────────────

  @Public()
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async signup(
    @Body() dto: SignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.signup(dto, req.ip, req.headers['user-agent']);
    this.setRefreshCookie(res, result.refreshToken, result.refreshExp);
    return { data: { user: result.user, accessToken: result.accessToken } };
  }

  // ─── Login ───────────────────────────────────────────────────────────────────

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, req.ip, req.headers['user-agent']);
    this.setRefreshCookie(res, result.refreshToken, result.refreshExp);
    return { data: { user: result.user, accessToken: result.accessToken } };
  }

  // ─── Password reset ──────────────────────────────────────────────────────────

  /**
   * ALWAYS 200, on every path — unknown address, Google-only account, or a link
   * genuinely sent. The response must not reveal whether an email is registered,
   * so there is deliberately nothing to branch on in the body either.
   *
   * The service applies its own per-address hourly budget on top of this
   * per-IP throttle; that one is what stops a single address being mail-bombed
   * from many IPs.
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.passwordResetService.request(dto.email, req.ip);
    return {
      data: { message: 'If this email is registered, a reset link has been sent.' },
    };
  }

  /**
   * Consumes the token and sets the new password. Deliberately does NOT sign the
   * user in: the reset revokes every refresh session (including any an attacker
   * holds), and issuing fresh tokens straight from a mailed link would hand a
   * session to whoever opened it. They log in again with the new password.
   */
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.passwordResetService.reset(dto.token, dto.password);
    return { data: { message: 'Password updated. Please sign in.' } };
  }

  /**
   * Set the first password on an account that has none (phone-signup onboarding).
   *
   * Authenticated, and deliberately NOT @Public — the caller's own token is the
   * authorisation, and the userId comes from that token rather than the body, so
   * one account can never set a password on another.
   *
   * A repeat call gets 409 PASSWORD_ALREADY_SET rather than silently
   * overwriting; see AuthService.setPassword for why that matters.
   */
  @Post('password/set')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async setPassword(@Body() dto: SetPasswordDto, @CurrentUser() actor: CurrentUserPayload) {
    await this.authService.setPassword(actor.userId, dto.password);
    return { data: { passwordSet: true } };
  }

  // ─── Google OAuth ─────────────────────────────────────────────────────────────

  @Public()
  @Get('google')
  @UseGuards(GoogleGuard)
  googleInit(): void {
    // GoogleGuard redirects to Google — no body returned.
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleGuard)
  async googleCallback(
    @Req() req: Request & { user: GoogleUser },
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.authService.handleGoogleCallback(
      req.user,
      req.ip,
      req.headers['user-agent'],
    );
    this.setRefreshCookie(res, result.refreshToken, result.refreshExp);
    res.redirect(`${result.webAppUrl}/callback`);
  }

  // ─── Refresh ─────────────────────────────────────────────────────────────────

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = (req.cookies as Record<string, string>)[REFRESH_COOKIE];
    if (!refreshToken) throw new UnauthorizedException({ code: 'INVALID_REFRESH' });

    const result = await this.tokenService.rotate(refreshToken, req.ip, req.headers['user-agent']);
    this.setRefreshCookie(res, result.refreshToken, result.refreshExp);
    return { data: { accessToken: result.accessToken } };
  }

  // ─── Logout ──────────────────────────────────────────────────────────────────

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: CurrentUserPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const ttl = user.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await this.tokenService.blacklistAccessJti(user.jti, ttl);
    }

    const refreshToken = (req.cookies as Record<string, string>)[REFRESH_COOKIE];
    if (refreshToken) {
      await this.tokenService.revokeByToken(refreshToken);
    }

    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

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
