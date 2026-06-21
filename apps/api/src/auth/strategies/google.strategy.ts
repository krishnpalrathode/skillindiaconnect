import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { GoogleUser } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get<string>('GOOGLE_OAUTH_CLIENT_ID')!,
      clientSecret: configService.get<string>('GOOGLE_OAUTH_CLIENT_SECRET')!,
      callbackURL: configService.get<string>('GOOGLE_OAUTH_CALLBACK_URL')!,
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const googleUser: GoogleUser = {
      googleId: profile.id,
      email: profile.emails![0]!.value,
      displayName: profile.displayName,
    };
    done(null, googleUser);
  }
}
