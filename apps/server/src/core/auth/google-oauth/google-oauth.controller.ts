import {
  Controller,
  Get,
  Logger,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GoogleOAuthService, GoogleProfile } from './google-oauth.service';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { FastifyReply, FastifyRequest } from 'fastify';
import { SkipThrottle } from '@nestjs/throttler';

const NONCE_COOKIE = 'google_oauth_nonce';

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
    const appUrl = this.environmentService.getAppUrl();
    const callbackUrl = `${appUrl}/api/sso/google/callback`;
    const nonce = randomBytes(16).toString('hex');
    const state = JSON.stringify({
      workspaceId,
      returnUrl: returnUrl || '/',
      nonce,
    });

    res.setCookie(NONCE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/api/sso/google/callback',
      maxAge: 300,
      secure: this.environmentService.isHttps(),
    });

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'email profile');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('access_type', 'online');
    authUrl.searchParams.set('prompt', 'select_account');

    return res.code(302).redirect(authUrl.toString());
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
      return this.redirectWithError(res, appUrl, 'Google login was cancelled');
    }

    let workspaceId: string;
    let nonce: string;
    try {
      const state = JSON.parse(googleUser.state || '{}');
      workspaceId = state.workspaceId;
      nonce = state.nonce;
    } catch {
      workspaceId = undefined;
    }

    const expectedNonce = req.cookies?.[NONCE_COOKIE];
    res.clearCookie(NONCE_COOKIE, { path: '/api/sso/google/callback' });

    if (!nonce || !expectedNonce || nonce !== expectedNonce) {
      return this.redirectWithError(
        res,
        appUrl,
        'Invalid OAuth state. Please try again.',
      );
    }

    if (!workspaceId) {
      return this.redirectWithError(res, appUrl, 'Workspace not found');
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

      return res.code(302).redirect(`${appUrl}${returnUrl}`);
    } catch (error: any) {
      this.logger.error(`Google OAuth callback error: ${error?.message}`);
      return this.redirectWithError(
        res,
        appUrl,
        error?.message || 'Google login failed',
      );
    }
  }

  private redirectWithError(res: FastifyReply, appUrl: string, message: string) {
    const errorMsg = encodeURIComponent(message);
    return res.code(302).redirect(`${appUrl}/login?error=${errorMsg}`);
  }
}
