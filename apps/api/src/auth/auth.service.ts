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
  // email is nullable on the column since phone signup; the response mirrors it.
  user: { id: string; email: string | null; role: UserRole };
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

    // email mirrors the column, which is nullable since phone signup.
    let user: { id: string; email: string | null; role: UserRole };
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
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        const prismaErr = err as Prisma.PrismaClientKnownRequestError;
        if (prismaErr.code === 'P2002') {
          throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Email already registered' });
        }
      }
      throw err;
    }

    const tokens = await this.tokenService.issue(user.id, user.email, user.role, ip, userAgent);
    return { user, ...tokens };
  }

  /**
   * Set the FIRST password on an account that has none.
   *
   * Phone signup creates an account with `passwordHash: null` — the phone is
   * the credential. Onboarding then asks for a password so the account has a
   * second way in (Decision 2), because a phone number can be lost, changed,
   * or left behind in another country, and WhatsApp delivery is not something
   * we control.
   *
   * ── Why it refuses when a password already exists ────────────────────────
   * This endpoint takes no current password — the access token is the only
   * proof. That is sound for an account with nothing to protect yet, and
   * unsound the moment there is. If it were allowed to overwrite, a stolen or
   * borrowed access token would be enough to change someone's password and
   * lock them out of their own account. Changing an existing password keeps
   * going through reset-password, which proves control of the mailbox.
   *
   * Google-only accounts are covered by the same rule for the same reason:
   * they have a credential already, so this is not their path.
   */
  async setPassword(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (user.passwordHash) {
      throw new ConflictException({ code: 'PASSWORD_ALREADY_SET' });
    }

    const passwordHash = await this.passwordService.hashPassword(password);

    // Guarded on passwordHash still being null, so two concurrent requests
    // cannot both pass the check above and race to write different hashes.
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, passwordHash: null },
      data: { passwordHash },
    });

    if (count === 0) {
      throw new ConflictException({ code: 'PASSWORD_ALREADY_SET' });
    }
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

    const tokens = await this.tokenService.issue(user.id, user.email, user.role, ip, userAgent);
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

    const tokens = await this.tokenService.issue(user.id, user.email, user.role, ip, userAgent);
    return { ...tokens, webAppUrl: this.configService.get<string>('WEB_APP_URL')! };
  }
}
