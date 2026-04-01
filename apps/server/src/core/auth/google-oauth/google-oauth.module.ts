import { Module } from '@nestjs/common';
import { GoogleOAuthController } from './google-oauth.controller';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleOAuthStrategy } from './google-oauth.strategy';
import { GoogleOAuthSeedService } from './google-oauth-seed.service';
import { WorkspaceModule } from '../../workspace/workspace.module';
import { SignupService } from '../services/signup.service';
import { TokenModule } from '../token.module';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

@Module({
  imports: [WorkspaceModule, TokenModule],
  controllers: [GoogleOAuthController],
  providers: [
    GoogleOAuthService,
    GoogleOAuthSeedService,
    SignupService,
    {
      provide: GoogleOAuthStrategy,
      useFactory: (env: EnvironmentService) => {
        if (env.isGoogleAuthEnabled()) {
          return new GoogleOAuthStrategy(env);
        }
        return null;
      },
      inject: [EnvironmentService],
    },
  ],
})
export class GoogleOAuthModule {}
