import {
  Controller,
  Get,
  Logger,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GoogleOAuthService, GoogleProfile } from './google-oauth.service';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { FastifyReply, FastifyRequest } from 'fastify';
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle()
@Controller('sso/google')
export class GoogleOAuthController {
  private readonly logger = new Logger(GoogleOAuthController.name);

  constructor(
    private readonly googleOAuthService: GoogleOAuthService,
    private readonly environmentService: EnvironmentService,
  ) {}

  @Get('login')
  async googleLogin(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
    @Query('workspaceId') workspaceId?: string,
    @Query('returnUrl') returnUrl?: string,
  ) {
    const clientId = this.environmentService.getGoogleClientId();
    const callbackUrl = `${this.environmentService.getAppUrl()}/api/sso/google/callback`;
    const state = JSON.stringify({ workspaceId, returnUrl: returnUrl || '/' });

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'email profile');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('access_type', 'online');
    authUrl.searchParams.set('prompt', 'select_account');

    return res.redirect(302, authUrl.toString());
  }

  @Get('callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const appUrl = this.environmentService.getAppUrl();

    const googleUser = (req as any).user as GoogleProfile | null;
    if (!googleUser) {
      const errorMsg = encodeURIComponent('Google 로그인이 취소되었습니다');
      return res.redirect(302, `${appUrl}/login?error=${errorMsg}`);
    }

    let workspaceId: string;
    try {
      const state = JSON.parse(googleUser.state || '{}');
      workspaceId = state.workspaceId || (req.raw as any)?.workspaceId;
    } catch {
      workspaceId = (req.raw as any)?.workspaceId;
    }

    if (!workspaceId) {
      const errorMsg = encodeURIComponent('Workspace를 찾을 수 없습니다');
      return res.redirect(302, `${appUrl}/login?error=${errorMsg}`);
    }

    try {
      const { token, returnUrl } =
        await this.googleOAuthService.handleGoogleLogin(
          googleUser,
          workspaceId,
        );

      res.setCookie('authToken', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        expires: this.environmentService.getCookieExpiresIn(),
        secure: this.environmentService.isHttps(),
      });

      return res.redirect(302, `${appUrl}${returnUrl}`);
    } catch (error) {
      this.logger.error(`Google OAuth callback error: ${error.message}`);
      const errorMsg = encodeURIComponent(
        error.message || 'Google 로그인에 실패했습니다',
      );
      return res.redirect(302, `${appUrl}/login?error=${errorMsg}`);
    }
  }
}
