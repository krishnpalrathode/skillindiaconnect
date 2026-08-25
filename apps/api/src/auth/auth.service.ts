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

export interface LinkedinUser {
  /** The OIDC `sub`. Pairwise — identifies the member to THIS app only. */
  linkedinId: string;
  email: string;
  displayName: string;
}

interface AuthResult extends IssuedTokens {
  // email is nullable on the column since phone signup; the response mirrors it.
  user: { id: string; email: string | null; role: UserRole };
}

interface OAuthCallbackResult extends IssuedTokens {
  webAppUrl: string;
}

/**
 * Everything that differs between one federated provider and the next.
 *
 * Google and LinkedIn resolve an account by exactly the same rules — match on
 * provider id, else adopt a matching candidate by email, else create one — and
 * those rules carry the security-relevant decisions (role gate, suspension
 * gate). Written twice they drift, and a rule that silently applies to one
 * provider but not the other is the kind of gap nobody notices until it is
 * exploited. So the RULES live once in `resolveFederatedUser` and a provider
 * supplies only this.
 */
interface FederatedProvider {
  /** Appears in error codes and copy — `GOOGLE_NOT_ALLOWED`, `LINKEDIN_NOT_ALLOWED`. */
  readonly name: 'GOOGLE' | 'LINKEDIN';
  /** Human label for the "wrong sign-in method" message. */
  readonly label: string;
  /**
   * The two Prisma clauses that touch this provider's column.
   *
   * Functions rather than a `'googleId' | 'linkedinId'` field name, because a
   * computed key produces `{ [x: string]: string }` — which Prisma's generated
   * `UserWhereUniqueInput` rightly refuses, since it cannot see that exactly one
   * unique column is being set. Casting past that would throw away the check
   * that the column exists and is unique, which is precisely the check worth
   * keeping on an identity lookup.
   */
  readonly whereProviderId: (id: string) => Prisma.UserWhereUniqueInput;
  /**
   * Narrow on purpose — a bare `{ googleId: string }`, not Prisma's update
   * input. The generated update type permits `StringFieldUpdateOperationsInput`
   * (`{ set: … }`) alongside a plain string, which does not fit the CREATE
   * input, and this same clause is spread into both.
   */
  readonly linkProviderId: (id: string) => { googleId: string } | { linkedinId: string };
}

const GOOGLE_PROVIDER: FederatedProvider = {
  name: 'GOOGLE',
  label: 'Google',
  whereProviderId: (googleId) => ({ googleId }),
  linkProviderId: (googleId) => ({ googleId }),
};

const LINKEDIN_PROVIDER: FederatedProvider = {
  name: 'LINKEDIN',
  label: 'LinkedIn',
  whereProviderId: (linkedinId) => ({ linkedinId }),
  linkProviderId: (linkedinId) => ({ linkedinId }),
};

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
      /*
        No password on file, so the account was created through a provider
        button. Name the RIGHT one: this message used to say "Google" for every
        such account, which sent LinkedIn users to a button that would refuse
        them and left them with no way in. Falls back to the generic phrasing if
        somehow neither id is set.
      */
      const provider = user.googleId
        ? GOOGLE_PROVIDER.label
        : user.linkedinId
          ? LINKEDIN_PROVIDER.label
          : null;

      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: provider
          ? `This account uses ${provider} sign-in`
          : 'This account uses social sign-in',
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
  ): Promise<OAuthCallbackResult> {
    return this.handleFederatedCallback(
      GOOGLE_PROVIDER,
      googleUser.googleId,
      googleUser.email,
      ip,
      userAgent,
    );
  }

  async handleLinkedinCallback(
    linkedinUser: LinkedinUser,
    ip?: string,
    userAgent?: string,
  ): Promise<OAuthCallbackResult> {
    return this.handleFederatedCallback(
      LINKEDIN_PROVIDER,
      linkedinUser.linkedinId,
      linkedinUser.email,
      ip,
      userAgent,
    );
  }

  /**
   * The shared federated sign-in path — resolve the account, then issue tokens.
   *
   * ── Two rules that were MISSING from the Google-only version ───────────────
   * Both are fixed here, for both providers, because both were bugs rather than
   * choices:
   *
   *  1. SUSPENSION was not checked. `login()` refuses a SUSPENDED account, but
   *     this path never looked — so an account suspended by an admin could sign
   *     straight back in through the OAuth button. Suspension that one button
   *     ignores is not suspension.
   *
   *  2. `lastLoginAt` was never written. That column is not decorative: the
   *     30-day inactivity check-in reads it to decide who has gone quiet. An
   *     OAuth-only candidate signing in daily still looked dormant, and was
   *     mailed "are you still looking?" while actively using the product.
   */
  private async handleFederatedCallback(
    provider: FederatedProvider,
    providerId: string,
    email: string,
    ip?: string,
    userAgent?: string,
  ): Promise<OAuthCallbackResult> {
    /*
      READ first, gate second, WRITE third — in that order deliberately.

      An earlier arrangement linked the provider id inside the lookup, before
      these gates ran. That attached a working LinkedIn/Google link to an account
      the very same request then refused: a SUSPENDED candidate would come out of
      a rejected sign-in with a live federated link waiting for the day the
      suspension is lifted. A login that is refused must leave no trace on the
      account.
    */
    const existing = await this.findFederatedUser(provider, providerId, email);

    if (existing) {
      // Role gate. Employers and admins reach their accounts by password only —
      // social signup would route around company verification entirely.
      if (existing.role !== UserRole.CANDIDATE) {
        throw new ForbiddenException({
          code: `${provider.name}_NOT_ALLOWED`,
          message: 'This email is registered as an employer or admin — use email/password sign-in',
        });
      }

      if (existing.status === UserStatus.SUSPENDED) {
        throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED' });
      }
    }

    const user = existing
      ? await this.linkAndTouch(provider, providerId, existing)
      : await this.createFederatedCandidate(provider, providerId, email);

    const tokens = await this.tokenService.issue(user.id, user.email, user.role, ip, userAgent);
    return { ...tokens, webAppUrl: this.configService.get<string>('WEB_APP_URL')! };
  }

  /**
   * Provider id → existing account, or null. READ ONLY — writes nothing, so the
   * caller can refuse a sign-in without having changed anything.
   *
   * Order matters. The provider id is checked FIRST so a returning user is
   * matched on the stable identifier rather than on an address they may have
   * changed at the provider since.
   */
  private async findFederatedUser(
    provider: FederatedProvider,
    providerId: string,
    email: string,
  ) {
    const byProviderId = await this.prisma.user.findUnique({
      where: provider.whereProviderId(providerId),
    });
    if (byProviderId) return byProviderId;

    // No provider match: an account may still exist under this address, and
    // adopting it is what keeps the unique-email constraint from rejecting a
    // candidate who originally signed up with a password.
    return this.prisma.user.findUnique({ where: { email } });
  }

  /**
   * Attach the provider id if it is not already attached, and stamp the login.
   *
   * One UPDATE for both, because they always happen together and a second round
   * trip buys nothing. The link is idempotent — a returning user is already
   * matched on it, and rewriting the same value is harmless.
   */
  private async linkAndTouch(
    provider: FederatedProvider,
    providerId: string,
    user: { id: string; email: string | null; role: UserRole },
  ) {
    return this.prisma.user.update({
      where: { id: user.id },
      data: { ...provider.linkProviderId(providerId), lastLoginAt: new Date() },
    });
  }

  /**
   * First-ever sign-in through this provider — a new candidate.
   *
   * `termsAcceptedAt` is stamped because the sign-up screen presents the terms
   * beside the provider button, which is the same consent the email form records.
   */
  private async createFederatedCandidate(
    provider: FederatedProvider,
    providerId: string,
    email: string,
  ) {
    try {
      return await this.prisma.user.create({
        data: {
          email,
          ...provider.linkProviderId(providerId),
          role: UserRole.CANDIDATE,
          termsAcceptedAt: new Date(),
          lastLoginAt: new Date(),
        },
      });
    } catch (err) {
      /*
        Two first-time sign-ins for the same person, racing.

        Both read "no such user" before either wrote, so both try to create. One
        wins; the loser gets P2002 on the unique email or provider-id index.
        Re-reading resolves it to the row the winner just created, which is the
        account the user expects either way. Without this the second tab shows a
        500 on what is, to the user, one sign-in.

        The re-read is returned WITHOUT re-applying the gates. That is safe here
        and only here: the row was created moments ago by the concurrent twin of
        this same request, so it is a CANDIDATE and ACTIVE by construction.
      */
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.user.findUnique({ where: { email } });
        if (existing) return existing;
      }
      throw err;
    }
  }
}
