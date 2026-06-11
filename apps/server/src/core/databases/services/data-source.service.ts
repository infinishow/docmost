import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { DataSourcePropertyRepo } from '@docmost/db/repos/data-source/data-source-property.repo';
import { DataSourceRepo } from '@docmost/db/repos/data-source/data-source.repo';
import { DataSourceViewRepo } from '@docmost/db/repos/data-source/data-source-view.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import {
  DataSource,
  DataSourceProperty,
  DataSourceView,
  User,
  Workspace,
} from '@docmost/db/types/entity.types';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import {
  CreateDataSourceDto,
  UpdateDataSourceDto,
} from '../dto/data-source.dto';
import { DataSourcePropertyType } from './property-value-normalizer';
import { DatabasePermissionService } from './database-permission.service';
import { PageAccessService } from '../../page/page-access/page-access.service';

@Injectable()
export class DataSourceService {
  constructor(
    private readonly dataSourceRepo: DataSourceRepo,
    private readonly propertyRepo: DataSourcePropertyRepo,
    private readonly viewRepo: DataSourceViewRepo,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly permissionService: DatabasePermissionService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async create(
    dto: CreateDataSourceDto,
    user: User,
    workspace: Workspace,
  ): Promise<{
    dataSource: DataSource;
    titleProperty: DataSourceProperty;
    defaultView: DataSourceView;
  }> {
    const parentPage = await this.pageRepo.findById(dto.parentPageId);
    if (
      !parentPage ||
      parentPage.deletedAt ||
      parentPage.workspaceId !== workspace.id
    ) {
      throw new NotFoundException('Parent page not found');
    }

    await this.pageAccessService.validateCanEdit(parentPage, user);

    return executeTx(this.db, async (trx) => {
      const firstPosition = generateJitteredKeyBetween(null, null);
      const dataSource = await this.dataSourceRepo.insert(
        {
          parentPageId: parentPage.id,
          workspaceId: parentPage.workspaceId,
          spaceId: parentPage.spaceId,
          name: dto.name,
          description: dto.description ?? null,
          createdById: user.id,
        },
        trx,
      );

      const titleProperty = await this.propertyRepo.insert(
        {
          dataSourceId: dataSource.id,
          name: 'Title',
          type: DataSourcePropertyType.Title,
          configJson: {},
          position: firstPosition,
          createdById: user.id,
        },
        trx,
      );

      const defaultView = await this.viewRepo.insert(
        {
          dataSourceId: dataSource.id,
          name: 'Table',
          type: 'table',
          configJson: {
            visiblePropertyIds: [titleProperty.id],
            propertyOrder: [titleProperty.id],
            filter: null,
            sort: [],
          },
          position: firstPosition,
          createdById: user.id,
        },
        trx,
      );

      return { dataSource, titleProperty, defaultView };
    });
  }

  async info(
    databaseId: string,
    user: User,
  ): Promise<{
    dataSource: DataSource;
    properties: DataSourceProperty[];
    views: DataSourceView[];
  }> {
    const dataSource = await this.findActiveDataSource(databaseId);
    await this.permissionService.validateRead(dataSource, user);
    const [properties, views] = await Promise.all([
      this.propertyRepo.findActiveByDataSource(dataSource.id),
      this.viewRepo.findActiveByDataSource(dataSource.id),
    ]);
    return { dataSource, properties, views };
  }

  async update(dto: UpdateDataSourceDto, user: User): Promise<DataSource> {
    const dataSource = await this.findActiveDataSource(dto.databaseId);
    await this.permissionService.validateWrite(dataSource, user);
    const updated = await this.dataSourceRepo.update(dataSource.id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
    });
    if (!updated) throw new NotFoundException('Database not found');
    return updated;
  }

  async delete(databaseId: string, user: User): Promise<void> {
    const dataSource = await this.findActiveDataSource(databaseId);
    await this.permissionService.validateWrite(dataSource, user);
    await this.dataSourceRepo.softDelete(dataSource.id);
  }

  private async findActiveDataSource(databaseId: string): Promise<DataSource> {
    const dataSource = await this.dataSourceRepo.findActiveById(databaseId);
    if (!dataSource) throw new NotFoundException('Database not found');
    return dataSource;
  }
}
