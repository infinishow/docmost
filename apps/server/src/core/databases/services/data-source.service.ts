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
    database: DataSourceResponse;
    defaultView: DataSourceViewResponse;
    properties: DataSourcePropertyResponse[];
    capabilities: DatabaseCapabilities;
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

      return {
        database: toDataSourceResponse(dataSource),
        defaultView: toDataSourceViewResponse(defaultView),
        properties: [toDataSourcePropertyResponse(titleProperty)],
        capabilities: writableCapabilities(),
      };
    });
  }

  async info(
    databaseId: string,
    user: User,
  ): Promise<{
    database: DataSourceResponse;
    properties: DataSourcePropertyResponse[];
    views: DataSourceViewResponse[];
    capabilities: DatabaseCapabilities;
  }> {
    const dataSource = await this.findActiveDataSource(databaseId);
    await this.permissionService.validateRead(dataSource, user);
    const [properties, views] = await Promise.all([
      this.propertyRepo.findActiveByDataSource(dataSource.id),
      this.viewRepo.findActiveByDataSource(dataSource.id),
    ]);
    return {
      database: toDataSourceResponse(dataSource),
      properties: properties.map(toDataSourcePropertyResponse),
      views: views.map(toDataSourceViewResponse),
      capabilities: writableCapabilities(),
    };
  }

  async update(
    dto: UpdateDataSourceDto,
    user: User,
  ): Promise<DataSourceResponse> {
    const dataSource = await this.findActiveDataSource(dto.databaseId);
    await this.permissionService.validateWrite(dataSource, user);
    const updated = await this.dataSourceRepo.update(dataSource.id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
    });
    if (!updated) throw new NotFoundException('Database not found');
    return toDataSourceResponse(updated);
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

type DataSourceResponse = Pick<
  DataSource,
  | 'id'
  | 'parentPageId'
  | 'workspaceId'
  | 'spaceId'
  | 'name'
  | 'description'
  | 'createdById'
  | 'createdAt'
  | 'updatedAt'
>;

type DataSourcePropertyResponse = {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  config: unknown;
  position: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type DataSourceViewResponse = {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  config: unknown;
  position: string;
  createdAt: Date;
  updatedAt: Date;
};

type DatabaseCapabilities = {
  canReadData: boolean;
  canWriteData: boolean;
  canWriteSchema: boolean;
  canWriteView: boolean;
};

function toDataSourceResponse(dataSource: DataSource): DataSourceResponse {
  return {
    id: dataSource.id,
    parentPageId: dataSource.parentPageId,
    workspaceId: dataSource.workspaceId,
    spaceId: dataSource.spaceId,
    name: dataSource.name,
    description: dataSource.description,
    createdById: dataSource.createdById,
    createdAt: dataSource.createdAt,
    updatedAt: dataSource.updatedAt,
  };
}

function toDataSourcePropertyResponse(
  property: DataSourceProperty,
): DataSourcePropertyResponse {
  return {
    id: property.id,
    databaseId: property.dataSourceId,
    name: property.name,
    type: property.type,
    config: property.configJson,
    position: property.position,
    version: property.version,
    createdAt: property.createdAt,
    updatedAt: property.updatedAt,
  };
}

function toDataSourceViewResponse(view: DataSourceView): DataSourceViewResponse {
  return {
    id: view.id,
    databaseId: view.dataSourceId,
    name: view.name,
    type: view.type,
    config: view.configJson,
    position: view.position,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

function writableCapabilities(): DatabaseCapabilities {
  return {
    canReadData: true,
    canWriteData: true,
    canWriteSchema: true,
    canWriteView: true,
  };
}
