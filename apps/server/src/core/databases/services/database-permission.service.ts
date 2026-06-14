import { Injectable, NotFoundException } from '@nestjs/common';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageAccessService } from '../../page/page-access/page-access.service';
import { DataSource, Page, User } from '@docmost/db/types/entity.types';

@Injectable()
export class DatabasePermissionService {
  constructor(
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
  ) {}

  async validateRead(dataSource: DataSource, user: User): Promise<Page> {
    const page = await this.resolveActiveParentPage(dataSource);
    await this.pageAccessService.validateCanView(page, user);
    return page;
  }

  async validateWrite(dataSource: DataSource, user: User): Promise<Page> {
    const page = await this.resolveActiveParentPage(dataSource);
    await this.pageAccessService.validateCanEdit(page, user);
    return page;
  }

  private async resolveActiveParentPage(dataSource: DataSource): Promise<Page> {
    const page = await this.pageRepo.findById(dataSource.parentPageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Database not found');
    }
    if (
      page.workspaceId !== dataSource.workspaceId ||
      page.spaceId !== dataSource.spaceId
    ) {
      throw new NotFoundException('Database not found');
    }
    return page;
  }
}
