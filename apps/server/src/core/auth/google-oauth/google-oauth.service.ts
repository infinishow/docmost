import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { SignupService } from '../services/signup.service';
import { SessionService } from '../../session/session.service';
import { validateAllowedEmail } from '../auth.util';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { UserRole } from '../../../common/helpers/types/permission';
import { AuditEvent, AuditResource } from '../../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../../integrations/audit/audit.service';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  state?: string;
}

@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly userRepo: UserRepo,
    private readonly signupService: SignupService,
    private readonly sessionService: SessionService,
    private readonly workspaceRepo: WorkspaceRepo,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async handleGoogleLogin(
    profile: GoogleProfile,
    workspaceId: string,
  ): Promise<{ token: string; returnUrl: string }> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) {
      throw new BadRequestException('Workspace not found');
    }

    validateAllowedEmail(profile.email, workspace);

    let user = await this.userRepo.findByEmail(profile.email, workspaceId);

    if (user) {
      await this.linkGoogleAccount(user.id, profile.googleId, workspaceId);
      await this.userRepo.updateLastLogin(user.id, workspaceId);

      this.auditService.log({
        event: AuditEvent.USER_LOGIN,
        resourceType: AuditResource.USER,
        resourceId: user.id,
        metadata: { source: 'google-oauth' },
      });
    } else {
      user = await this.signupService.signup(
        {
          name: profile.name,
          email: profile.email,
          password: crypto.randomUUID(),
          role: UserRole.MEMBER,
        },
        workspaceId,
      );

      await this.linkGoogleAccount(user.id, profile.googleId, workspaceId);

      this.auditService.log({
        event: AuditEvent.USER_CREATED,
        resourceType: AuditResource.USER,
        resourceId: user.id,
        metadata: { source: 'google-oauth' },
      });
    }

    const token = await this.sessionService.createSessionAndToken(user);
    const returnUrl = this.parseReturnUrl(profile.state);

    return { token, returnUrl };
  }

  private async linkGoogleAccount(
    userId: string,
    googleId: string,
    workspaceId: string,
  ) {
    const authProvider = await this.db
      .selectFrom('authProviders')
      .select(['id'])
      .where('type', '=', 'google')
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!authProvider) return;

    const existing = await this.db
      .selectFrom('authAccounts')
      .select(['id'])
      .where('userId', '=', userId)
      .where('authProviderId', '=', authProvider.id)
      .executeTakeFirst();

    if (!existing) {
      await this.db
        .insertInto('authAccounts')
        .values({
          userId,
          providerUserId: googleId,
          authProviderId: authProvider.id,
          workspaceId,
        })
        .execute();
    }
  }

  private parseReturnUrl(state?: string): string {
    if (!state) return '/';
    try {
      const parsed = JSON.parse(state);
      return parsed.returnUrl || '/';
    } catch {
      return '/';
    }
  }
}
