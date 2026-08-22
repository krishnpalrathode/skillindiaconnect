import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
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
import { AuthService, GoogleUser, LinkedinUser } from './auth.service';
import { TokenService } from './token.service';
import { GoogleGuard } from './guards/google.guard';
import { LinkedinGuard, isOAuthFailure, OAuthFailure } from './guards/linkedin.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser, CurrentUserPayload } from './decorators/current-user.decorator';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordResetService } from './password-reset.service';

const REFRESH_COOKIE = 'sic_refresh';

/**
 * The codes an OAuth callback is allowed to convert into a redirect.
 *
 * An allowlist rather than "any ForbiddenException", so a refusal added
 * elsewhere later cannot start silently swallowing itself into a redirect
 * without someone deciding that is right.
 */
const REDIRECTABLE_OAUTH_CODES = new Set([
  'GOOGLE_NOT_ALLOWED',
  'LINKEDIN_NOT_ALLOWED',
  'ACCOUNT_SUSPENDED',
]);

/**
 * Pull the machine-readable `code` out of a thrown HttpException.
 *
 * Nest wraps the object passed to `new ForbiddenException({ code })` as the
 * exception's `response`, so the code is not on the error directly. Returns null
 * for anything that is not a redirectable refusal, which the caller treats as
 * "rethrow".
 */
function extractErrorCode(err: unknown): string | null {
  if (!(err instanceof HttpException)) return null;
  const response = err.getResponse();
  if (typeof response !== 'object' || response === null) return null;
  const code = (response as { code?: unknown }).code;
  return typeof code === 'string' && REDIRECTABLE_OAUTH_CODES.has(code) ? code : null;
}

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
    /*
      Wrapped so a refused sign-in ends on the LOGIN PAGE, not on a JSON body.

      This route is the tail of a browser redirect chain. When the service threw
      GOOGLE_NOT_ALLOWED — an employer or admin pressing the Google button — Nest
      rendered a 403 JSON error into the browser on the API's domain: no styling,
      no explanation, no link back. openapi.yaml has always DOCUMENTED the
      redirect-with-`?error=` behaviour for this endpoint; it was simply never
      implemented. This makes reality match the contract.
    */
    await this.completeOAuthCallback(res, () =>
      this.authService.handleGoogleCallback(req.user, req.ip, req.headers['user-agent']),
    );
  }

  // ─── LinkedIn OAuth (OpenID Connect) ─────────────────────────────────────────

  /**
   * Candidates only, exactly like Google — the role gate lives in AuthService.
   *
   * Both routes tolerate the provider being unconfigured. LINKEDIN_OAUTH_* are
   * optional env vars (see env.schema.ts), so on a deployment that has not set
   * them the strategy is never registered and `AuthGuard('linkedin')` would
   * throw "Unknown authentication strategy" — a 500 for what is really a
   * deliberate configuration state. The check turns that into an ordinary
   * message on the login page.
   */
  @Public()
  @Get('linkedin')
  @UseGuards(LinkedinGuard)
  linkedinInit(@Res() res: Response): void {
    // Only reached when the provider is NOT configured: with the strategy
    // registered, the guard has already redirected to LinkedIn and this body
    // never runs.
    this.redirectToLogin(res, 'LINKEDIN_UNAVAILABLE');
  }

  @Public()
  @Get('linkedin/callback')
  @UseGuards(LinkedinGuard)
  async linkedinCallback(
    @Req() req: Request & { user: LinkedinUser | OAuthFailure },
    @Res() res: Response,
  ): Promise<void> {
    // The guard converts every handshake failure into this sentinel rather than
    // throwing, so the user gets a page instead of a stack trace.
    if (isOAuthFailure(req.user)) {
      this.redirectToLogin(res, req.user.oauthError);
      return;
    }

    const linkedinUser = req.user;
    await this.completeOAuthCallback(res, () =>
      this.authService.handleLinkedinCallback(linkedinUser, req.ip, req.headers['user-agent']),
    );
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

  /**
   * Finish a provider callback: set the session cookie and land the browser on
   * the app — or, if the sign-in was refused, on the login page with a code.
   *
   * Shared by both providers so an error path fixed for one cannot stay broken
   * for the other.
   *
   * Only the `code` crosses the redirect, never the message. The message is
   * server copy in one language; the code lets the web app show translated text,
   * which matters for a product that ships ten locales.
   */
  private async completeOAuthCallback(
    res: Response,
    run: () => Promise<{ refreshToken: string; refreshExp: number; webAppUrl: string }>,
  ): Promise<void> {
    try {
      const result = await run();
      this.setRefreshCookie(res, result.refreshToken, result.refreshExp);
      res.redirect(`${result.webAppUrl}/callback`);
    } catch (err) {
      /*
        Only the deliberate refusals are turned into a redirect — a role gate or
        a suspended account. Anything else (a database outage, a bug) is
        rethrown so it is logged and reported as the 500 it is, rather than
        being disguised as a tidy "please try again" that hides an incident.
      */
      const code = extractErrorCode(err);
      if (!code) throw err;
      this.redirectToLogin(res, code);
    }
  }

  /** Back to the login screen with a machine-readable reason in the query. */
  private redirectToLogin(res: Response, code: string): void {
    const webAppUrl = this.configService.get<string>('WEB_APP_URL')!;
    res.redirect(`${webAppUrl}/login?error=${encodeURIComponent(code)}`);
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
