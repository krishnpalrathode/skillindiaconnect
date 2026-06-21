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

const REFRESH_COOKIE = 'sic_refresh';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService,
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
    res.redirect(`${result.webAppUrl}/auth/callback`);
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
