import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';

@Injectable()
export class GoogleOAuthSeedService implements OnModuleInit {
  private readonly logger = new Logger(GoogleOAuthSeedService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
    private readonly workspaceRepo: WorkspaceRepo,
  ) {}

  async onModuleInit() {
    await this.seedGoogleProvider();
  }

  private async seedGoogleProvider() {
    const workspaces = await this.db
      .selectFrom('workspaces')
      .select(['id'])
      .execute();

    if (workspaces.length === 0) {
      return;
    }

    const allowedDomains = this.environmentService.getGoogleAllowedDomains();

    for (const workspace of workspaces) {
      await this.syncProviderForWorkspace(workspace.id);

      if (allowedDomains.length > 0) {
        await this.syncEmailDomains(workspace.id, allowedDomains);
      }
    }
  }

  private async syncProviderForWorkspace(workspaceId: string) {
    const existing = await this.db
      .selectFrom('authProviders')
      .select(['id'])
      .where('type', '=', 'google')
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (existing) {
      await this.db
        .updateTable('authProviders')
        .set({
          oidcClientId: this.environmentService.getGoogleClientId(),
          oidcClientSecret: this.environmentService.getGoogleClientSecret(),
          isEnabled: true,
          allowSignup: true,
          updatedAt: new Date(),
        })
        .where('id', '=', existing.id)
        .execute();

      this.logger.log(
        `Updated Google OAuth provider for workspace ${workspaceId}`,
      );
    } else {
      await this.db
        .insertInto('authProviders')
        .values({
          name: 'Google',
          type: 'google',
          oidcClientId: this.environmentService.getGoogleClientId(),
          oidcClientSecret: this.environmentService.getGoogleClientSecret(),
          isEnabled: true,
          allowSignup: true,
          workspaceId,
        })
        .execute();

      this.logger.log(
        `Created Google OAuth provider for workspace ${workspaceId}`,
      );
    }
  }

  private async syncEmailDomains(
    workspaceId: string,
    allowedDomains: string[],
  ) {
    const workspace = await this.db
      .selectFrom('workspaces')
      .select(['emailDomains'])
      .where('id', '=', workspaceId)
      .executeTakeFirst();

    const currentDomains = workspace?.emailDomains ?? [];
    const mergedDomains = [
      ...new Set([...currentDomains, ...allowedDomains]),
    ];

    if (
      mergedDomains.length !== currentDomains.length ||
      !mergedDomains.every((d) => currentDomains.includes(d))
    ) {
      await this.db
        .updateTable('workspaces')
        .set({ emailDomains: mergedDomains })
        .where('id', '=', workspaceId)
        .execute();

      this.logger.log(
        `Synced email domains for workspace ${workspaceId}: ${mergedDomains.join(', ')}`,
      );
    }
  }
}
