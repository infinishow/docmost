import { Module } from '@nestjs/common';
import { GoogleOAuthController } from './google-oauth.controller';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleOAuthStrategy } from './google-oauth.strategy';
import { GoogleOAuthSeedService } from './google-oauth-seed.service';
import { WorkspaceModule } from '../../workspace/workspace.module';

@Module({
  imports: [WorkspaceModule],
  controllers: [GoogleOAuthController],
  providers: [GoogleOAuthService, GoogleOAuthStrategy, GoogleOAuthSeedService],
})
export class GoogleOAuthModule {}
