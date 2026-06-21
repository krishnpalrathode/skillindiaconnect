import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { PasswordService } from './password.service';
import { TokenService, IssuedTokens } from './token.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

export interface GoogleUser {
  googleId: string;
  email: string;
  displayName: string;
}

interface AuthResult extends IssuedTokens {
  user: { id: string; email: string; role: UserRole };
}

interface GoogleCallbackResult extends IssuedTokens {
  webAppUrl: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService,
  ) {}

  async signup(dto: SignupDto, ip?: string, userAgent?: string): Promise<AuthResult> {
    const passwordHash = await this.passwordService.hashPassword(dto.password);

    let user: { id: string; email: string; role: UserRole };
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          role: dto.role as UserRole,
          termsAcceptedAt: new Date(),
        },
        select: { id: true, email: true, role: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Email already registered' });
      }
      throw err;
    }

    const tokens = await this.tokenService.issue(user.id, user.role, ip, userAgent);
    return { user, ...tokens };
  }

  async login(dto: LoginDto, ip?: string, userAgent?: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }

    if (!user.passwordHash) {
      // Google-only account — guide user to the right sign-in method.
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'This account uses Google sign-in',
      });
    }

    const valid = await this.passwordService.verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED' });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.tokenService.issue(user.id, user.role, ip, userAgent);
    return { user: { id: user.id, email: user.email, role: user.role }, ...tokens };
  }

  async handleGoogleCallback(
    googleUser: GoogleUser,
    ip?: string,
    userAgent?: string,
  ): Promise<GoogleCallbackResult> {
    // 1) Try to find by googleId (returning user).
    let user = await this.prisma.user.findUnique({
      where: { googleId: googleUser.googleId },
    });

    if (!user) {
      // 2) Try to find by email.
      const byEmail = await this.prisma.user.findUnique({
        where: { email: googleUser.email },
      });

      if (byEmail) {
        if (byEmail.role !== UserRole.CANDIDATE) {
          throw new ForbiddenException({
            code: 'GOOGLE_NOT_ALLOWED',
            message:
              'This email is registered as an employer or admin — use email/password sign-in',
          });
        }
        // Link Google ID to the existing candidate account.
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: { googleId: googleUser.googleId },
        });
      } else {
        // 3) New user — create candidate account.
        user = await this.prisma.user.create({
          data: {
            email: googleUser.email,
            googleId: googleUser.googleId,
            role: UserRole.CANDIDATE,
            termsAcceptedAt: new Date(),
          },
        });
      }
    }

    // System invariant: Google sign-in is for candidates only.
    if (user.role !== UserRole.CANDIDATE) {
      throw new ForbiddenException({ code: 'GOOGLE_NOT_ALLOWED' });
    }

    const tokens = await this.tokenService.issue(user.id, user.role, ip, userAgent);
    return { ...tokens, webAppUrl: this.configService.get<string>('WEB_APP_URL')! };
  }
}
