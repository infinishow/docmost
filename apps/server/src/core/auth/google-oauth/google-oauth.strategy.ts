import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

@Injectable()
export class GoogleOAuthStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly environmentService: EnvironmentService) {
    super({
      clientID: environmentService.getGoogleClientId(),
      clientSecret: environmentService.getGoogleClientSecret(),
      callbackURL: `${environmentService.getAppUrl()}/api/sso/google/callback`,
      scope: ['email', 'profile'],
      passReqToCallback: true,
    });
  }

  async validate(
    req: any,
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<void> {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      return done(new Error('No email returned from Google'), null);
    }

    const user = {
      googleId: profile.id,
      email: email.toLowerCase(),
      name: profile.displayName || email.split('@')[0],
      state: req.query?.state,
    };

    done(null, user);
  }
}
