import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { PermissionService } from './rbac/permission.service';
import { OtpService } from './otp/otp.service';
import { OtpController } from './otp/otp.controller';
import { WhatsappModule } from '../notifications/channels/whatsapp.module';

@Module({
  imports: [
    PassportModule.register({ session: false }),
    // Secret and TTL are overridden per-call in TokenService so no global config needed here.
    JwtModule.register({}),
    WhatsappModule,
  ],
  controllers: [AuthController, OtpController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    GoogleStrategy,
    PermissionService,
    OtpService,
  ],
  // JwtModule re-exported so AppApiModule can resolve JwtService for JwtAuthGuard (APP_GUARD).
  // PermissionService exported so other modules (S6 Admin) can inject it without owning the table.
  exports: [TokenService, JwtModule, PermissionService],
})
export class AuthModule {}
