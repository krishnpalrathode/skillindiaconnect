import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { isLinkedinConfigured, LinkedinStrategy } from './strategies/linkedin.strategy';
import { PermissionService } from './rbac/permission.service';
import { RbacMatrixController } from './rbac/rbac-matrix.controller';
import { RbacMatrixService } from './rbac/rbac-matrix.service';
import { AdminMeController } from './rbac/admin-me.controller';
import { OtpService } from './otp/otp.service';
import { OtpController } from './otp/otp.controller';
import { PasswordResetService } from './password-reset.service';
import { WhatsappModule } from '../notifications/channels/whatsapp.module';
import { NotificationModule } from '../notifications/notification.module';
import { CandidateModule } from '../candidate/candidate.module';

/**
 * LinkedIn is registered ONLY when it is fully configured.
 *
 * A Passport strategy registers itself with Passport the moment it is
 * constructed, and passport-oauth2 throws `TypeError: OAuth2Strategy requires a
 * clientID option` on a missing key. Listing LinkedinStrategy as a plain
 * provider would therefore make the whole API refuse to BOOT anywhere the
 * LinkedIn app has not been provisioned — CI, a fresh clone, and every existing
 * production deploy on the release that introduces this. Adding a sign-in option
 * must not be able to take the service down.
 *
 * The factory returns `null` when unconfigured, so the strategy is never
 * constructed and never registers. `AuthGuard('linkedin')` then reports an
 * unknown strategy, which LinkedinGuard turns into a plain
 * `?error=LINKEDIN_UNAVAILABLE` on the login page.
 *
 * Google keeps its unconditional registration: its keys are required env vars,
 * so an unconfigured Google is already impossible by the time this runs.
 */
const linkedinStrategyProvider: Provider = {
  provide: LinkedinStrategy,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): LinkedinStrategy | null =>
    isLinkedinConfigured(configService) ? new LinkedinStrategy(configService) : null,
};

@Module({
  imports: [
    PassportModule.register({ session: false }),
    // Secret and TTL are overridden per-call in TokenService so no global config needed here.
    JwtModule.register({}),
    WhatsappModule,
    // NotificationModule imported for its PUBLIC NotificationService export, so
    // the reset link is ENQUEUED and sent by the worker rather than mailed from
    // the API process (worker-and-external-sends.md).
    NotificationModule,
    // CandidateModule imported so OtpController can use CandidateReadService
    // instead of querying candidate_profiles directly (module-boundaries.md Rule 4).
    CandidateModule,
  ],
  // RbacMatrixController (S6a-B2, Screen 27) lives here because `role_permissions`
  // is THIS module's table (Rule 4). AuthModule is imported by the API root only —
  // the worker root never loads it — so adding a controller here cannot leak an
  // HTTP surface into the worker process.
  controllers: [AuthController, OtpController, RbacMatrixController, AdminMeController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    GoogleStrategy,
    linkedinStrategyProvider,
    PermissionService,
    RbacMatrixService,
    OtpService,
    PasswordResetService,
  ],
  // JwtModule re-exported so AppApiModule can resolve JwtService for JwtAuthGuard (APP_GUARD).
  // PermissionService exported so other modules (S6 Admin) can inject it without owning the table.
  exports: [TokenService, JwtModule, PermissionService],
})
export class AuthModule {}
