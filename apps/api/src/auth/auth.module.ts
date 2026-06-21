import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { GoogleStrategy } from './strategies/google.strategy';

@Module({
  imports: [
    PassportModule.register({ session: false }),
    // Secret and TTL are overridden per-call in TokenService so no global config needed here.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, GoogleStrategy],
  // JwtModule re-exported so AppApiModule can resolve JwtService for JwtAuthGuard (APP_GUARD).
  exports: [TokenService, JwtModule],
})
export class AuthModule {}
