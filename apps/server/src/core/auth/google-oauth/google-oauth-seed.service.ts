import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

@Injectable()
export class GoogleOAuthSeedService implements OnModuleInit {
  private readonly logger = new Logger(GoogleOAuthSeedService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
  ) {}

  async onModuleInit() {
    if (!this.environmentService.isGoogleAuthEnabled()) {
      await this.disableGoogleProvider();
      return;
    }
    await this.seedGoogleProvider();
  }

  private async disableGoogleProvider() {
    const result = await this.db
      .updateTable('authProviders')
      .set({ isEnabled: false, updatedAt: new Date() })
      .where('type', '=', 'google')
      .where('isEnabled', '=', true)
      .execute();

    if (result?.[0]?.numUpdatedRows > 0n) {
      this.logger.log('Google OAuth provider disabled (env vars not set)');
    }
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
      .limit(1)
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
    } else {
      // Double-check to prevent race condition on fast restarts
      const doubleCheck = await this.db
        .selectFrom('authProviders')
        .select(['id'])
        .where('type', '=', 'google')
        .where('workspaceId', '=', workspaceId)
        .executeTakeFirst();

      if (!doubleCheck) {
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
      }
    }

    this.logger.log(`Google OAuth provider synced for workspace ${workspaceId}`);
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
