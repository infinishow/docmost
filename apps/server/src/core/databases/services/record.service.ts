import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { DataSourcePropertyRepo } from '@docmost/db/repos/data-source/data-source-property.repo';
import { DataSourcePropertyValueRepo } from '@docmost/db/repos/data-source/data-source-property-value.repo';
import {
  DataSourceRecordQueryFilter,
  DataSourceRecordQueryFilterOperator,
  DataSourceRecordQueryOptions,
  DataSourceRecordQuerySort,
  DataSourceRecordRepo,
} from '@docmost/db/repos/data-source/data-source-record.repo';
import { DataSourceRepo } from '@docmost/db/repos/data-source/data-source.repo';
import { DataSourceViewRepo } from '@docmost/db/repos/data-source/data-source-view.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import {
  DataSource,
  DataSourceProperty,
  DataSourcePropertyValue,
  DataSourceRecord,
  InsertableDataSourcePropertyValue,
  User,
} from '@docmost/db/types/entity.types';
import { Json } from '@docmost/db/types/db';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { CreateRecordDto, UpdateRecordDto } from '../dto/record.dto';
import { QueryRecordsDto } from '../dto/query.dto';
import { DatabasePermissionService } from './database-permission.service';
import {
  DataSourcePropertyType,
  normalizePropertyValue,
} from './property-value-normalizer';

@Injectable()
export class RecordService {
  constructor(
    private readonly dataSourceRepo: DataSourceRepo,
    private readonly recordRepo: DataSourceRecordRepo,
    private readonly propertyRepo: DataSourcePropertyRepo,
    private readonly viewRepo: DataSourceViewRepo,
    private readonly propertyValueRepo: DataSourcePropertyValueRepo,
    private readonly permissionService: DatabasePermissionService,
    private readonly userRepo: UserRepo,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async create(
    dto: CreateRecordDto,
    user: User,
  ): Promise<{ record: DataSourceRecord; values: RecordValueResponse[] }> {
    const dataSource = await this.findActiveDataSource(dto.databaseId);
    await this.validateWrite(dataSource, user);
    return executeTx(this.db, async (trx) => {
      const lastPosition = await this.recordRepo.findLastPosition(
        dataSource.id,
        trx,
      );
      const record = await this.recordRepo.insert(
        {
          dataSourceId: dataSource.id,
          position:
            validatePosition(dto.position) ??
            generateJitteredKeyBetween(lastPosition ?? null, null),
          createdById: user.id,
        },
        trx,
      );
      const values: DataSourcePropertyValue[] = [];
      if (dto.values) {
        const properties = await this.propertyRepo.findActiveByDataSource(
          dataSource.id,
          trx,
        );
        const propertyById = new Map(properties.map((item) => [item.id, item]));
        const valueInputs: Array<
          Omit<DataSourcePropertyValueInsert, 'dataSourceId' | 'recordId'>
        > = [];
        for (const [propertyId, value] of Object.entries(dto.values)) {
          const property = propertyById.get(propertyId);
          if (!property) {
            throw new BadRequestException(
              'Property does not belong to database',
            );
          }
          valueInputs.push(this.normalizeValue(property, value, user));
        }
        await this.validatePersonUserIds(
          valueInputs.flatMap((item) => item.personUserIds),
          user,
          trx,
        );
        values.push(
          ...(await this.propertyValueRepo.upsertMany(
            valueInputs.map(({ personUserIds: _personUserIds, ...value }) => ({
              dataSourceId: record.dataSourceId,
              recordId: record.id,
              ...value,
            })),
            trx,
          )),
        );
        if (values.length > 0) {
          await this.recordRepo.incrementVersion(record.id, trx);
        }
      }
      return {
        record:
          values.length > 0
            ? { ...record, version: (record.version ?? 1) + 1 }
            : record,
        values: values.map(toRecordValueResponse),
      };
    });
  }

  async update(dto: UpdateRecordDto, user: User): Promise<DataSourceRecord> {
    const record = await this.findActiveRecord(dto.recordId);
    const dataSource = await this.findActiveDataSource(record.dataSourceId);
    await this.validateWrite(dataSource, user);
    const updated = await this.recordRepo.update(record.id, {
      ...(dto.position !== undefined
        ? { position: validatePosition(dto.position) }
        : {}),
    });
    if (!updated) throw new NotFoundException('Record not found');
    return updated;
  }

  async delete(recordId: string, user: User): Promise<void> {
    const record = await this.findActiveRecord(recordId);
    const dataSource = await this.findActiveDataSource(record.dataSourceId);
    await this.validateWrite(dataSource, user);
    await executeTx(this.db, async (trx) => {
      await this.recordRepo.softDelete(record.id, trx);
      await this.propertyValueRepo.softDeleteByRecordId(record.id, trx);
    });
  }

  async query(dto: QueryRecordsDto, user: User) {
    const dataSource = await this.findActiveDataSource(dto.databaseId);
    await this.validateRead(dataSource, user);
    const properties = await this.propertyRepo.findActiveByDataSource(
      dataSource.id,
    );
    const viewConfig = dto.viewId
      ? await this.findViewQueryConfig(dto.viewId, dataSource.id)
      : undefined;
    const queryConfig = this.buildQueryConfig(dto, properties, viewConfig);
    const { visiblePropertyIds, ...repoQueryConfig } = queryConfig;
    const result = await this.recordRepo.query({
      databaseId: dataSource.id,
      limit: dto.limit ?? 50,
      cursor: dto.cursor,
      ...repoQueryConfig,
    });
    const recordIds = result.items.map((record) => record.id);
    const values = await this.findValuesByRecordIds(recordIds);
    const valuesByRecordId = new Map<
      string,
      Record<string, RecordValueResponse>
    >();
    for (const value of values) {
      if (visiblePropertyIds && !visiblePropertyIds.has(value.propertyId)) {
        continue;
      }
      const bucket = valuesByRecordId.get(value.recordId) ?? {};
      bucket[value.propertyId] = toRecordValueResponse(value);
      valuesByRecordId.set(value.recordId, bucket);
    }
    return {
      ...result,
      items: result.items.map((record) =>
        toRecordResponse(record, valuesByRecordId.get(record.id) ?? {}),
      ),
    };
  }

  private normalizeValue(
    property: DataSourceProperty,
    value: unknown,
    user: User,
  ): Omit<DataSourcePropertyValueInsert, 'dataSourceId' | 'recordId'> {
    const normalized = normalizePropertyValue({
      type: property.type,
      value,
      config: property.configJson as Record<string, any>,
    });
    return {
      propertyId: property.id,
      createdById: user.id,
      lastEditedById: user.id,
      ...normalized,
      valueJson: normalized.valueJson as Json,
      personUserIds:
        property.type === DataSourcePropertyType.Person &&
        normalized.valueJson !== null
          ? (normalized.valueJson as string[])
          : [],
    };
  }

  private async findValuesByRecordIds(recordIds: string[]) {
    return this.recordRepo.findValuesByRecordIds(recordIds);
  }

  private buildQueryConfig(
    dto: QueryRecordsDto,
    properties: DataSourceProperty[],
    viewConfig?: ViewQueryConfig,
  ): Pick<DataSourceRecordQueryOptions, 'filter' | 'sort'> & {
    visiblePropertyIds?: Set<string>;
  } {
    const propertyById = new Map(properties.map((item) => [item.id, item]));
    const viewFilter = this.buildFilter(viewConfig?.filter, propertyById);
    const requestFilter = this.buildFilter(dto.filter, propertyById);
    const filter =
      viewFilter && requestFilter
        ? ({ and: [viewFilter, requestFilter] } as DataSourceRecordQueryFilter)
        : (requestFilter ?? viewFilter);
    if (filter) {
      this.validateFilterLimits(filter, 1, { value: 0 });
    }
    const sort = this.buildSort(dto.sort ?? viewConfig?.sort, propertyById);
    return {
      ...(filter ? { filter } : {}),
      ...(sort ? { sort } : {}),
      ...(viewConfig?.visiblePropertyIds
        ? { visiblePropertyIds: new Set(viewConfig.visiblePropertyIds) }
        : {}),
    };
  }

  private buildFilter(
    filter: unknown,
    propertyById: Map<string, DataSourceProperty>,
  ): DataSourceRecordQueryFilter | undefined {
    if (filter === undefined || filter === null) return undefined;
    const leafCount = { value: 0 };
    return this.buildFilterNode(filter, propertyById, 1, leafCount);
  }

  private validateFilterLimits(
    filter: DataSourceRecordQueryFilter,
    depth: number,
    leafCount: { value: number },
  ): void {
    if (depth > 3) throw new BadRequestException('Filter is too deeply nested');
    if ('and' in filter || 'or' in filter) {
      const children = 'and' in filter ? filter.and : filter.or;
      for (const child of children) {
        this.validateFilterLimits(child, depth + 1, leafCount);
      }
      return;
    }
    leafCount.value += 1;
    if (leafCount.value > 20) {
      throw new BadRequestException('Too many filter conditions');
    }
  }

  private buildFilterNode(
    filter: unknown,
    propertyById: Map<string, DataSourceProperty>,
    depth: number,
    leafCount: { value: number },
  ): DataSourceRecordQueryFilter {
    if (!isRecord(filter)) throw new BadRequestException('Invalid filter');
    if (depth > 3) throw new BadRequestException('Filter is too deeply nested');

    if (Array.isArray(filter.and) || Array.isArray(filter.or)) {
      const key = Array.isArray(filter.and) ? 'and' : 'or';
      const children = filter[key];
      if (!Array.isArray(children) || children.length === 0) {
        throw new BadRequestException('Invalid filter group');
      }
      return {
        [key]: children.map((child) =>
          this.buildFilterNode(child, propertyById, depth + 1, leafCount),
        ),
      } as DataSourceRecordQueryFilter;
    }

    const { propertyId, operator, value } = filter;
    if (typeof propertyId !== 'string') {
      throw new BadRequestException('Invalid filter property');
    }
    if (typeof operator !== 'string') {
      throw new BadRequestException('Invalid filter operator');
    }
    leafCount.value += 1;
    if (leafCount.value > 20) {
      throw new BadRequestException('Too many filter conditions');
    }

    const property = propertyById.get(propertyId);
    if (!property) throw new BadRequestException('Filter property not found');
    if (
      property.type === DataSourcePropertyType.MultiSelect ||
      property.type === DataSourcePropertyType.Person
    ) {
      throw new BadRequestException('Unsupported filter property type');
    }
    if (operator === 'contains' && !isTextFilterType(property.type)) {
      throw new BadRequestException('Unsupported filter operator');
    }
    if (operator === 'contains' && typeof value !== 'string') {
      throw new BadRequestException('Filter value must be a string');
    }
    if (!isSupportedFilterOperator(property.type, operator)) {
      throw new BadRequestException('Unsupported filter operator');
    }

    return {
      propertyId,
      type: property.type,
      operator: operator as DataSourceRecordQueryFilterOperator,
      ...(operatorRequiresValue(operator)
        ? { value: normalizeFilterValue(property, operator, value) }
        : {}),
    } as DataSourceRecordQueryFilter;
  }

  private buildSort(
    sort: unknown,
    propertyById: Map<string, DataSourceProperty>,
  ): DataSourceRecordQuerySort[] | undefined {
    if (sort === undefined || sort === null) return undefined;
    const sortItems = Array.isArray(sort) ? sort : [sort];
    if (sortItems.length > 3) {
      throw new BadRequestException('Too many sort conditions');
    }
    if (sortItems.length === 0) return undefined;

    return sortItems.map((item) => {
      if (!isRecord(item)) throw new BadRequestException('Invalid sort');
      const { propertyId, direction = 'asc' } = item;
      if (typeof propertyId !== 'string') {
        throw new BadRequestException('Invalid sort property');
      }
      if (direction !== 'asc' && direction !== 'desc') {
        throw new BadRequestException('Invalid sort direction');
      }

      const property = propertyById.get(propertyId);
      if (!property) throw new BadRequestException('Sort property not found');
      if (!isSupportedSortType(property.type)) {
        throw new BadRequestException('Unsupported sort property type');
      }

      return { propertyId, type: property.type, direction };
    });
  }

  private async findActiveDataSource(databaseId: string) {
    const dataSource = await this.dataSourceRepo.findActiveById(databaseId);
    if (!dataSource) throw new NotFoundException('Database not found');
    return dataSource;
  }

  private async findActiveRecord(recordId: string) {
    const record = await this.recordRepo.findActiveById(recordId);
    if (!record) throw new NotFoundException('Record not found');
    return record;
  }

  private async findViewQueryConfig(
    viewId: string,
    dataSourceId: string,
  ): Promise<ViewQueryConfig> {
    const view = await this.viewRepo.findActiveById(viewId);
    if (!view || view.dataSourceId !== dataSourceId) {
      throw new NotFoundException('View not found');
    }
    const config = isRecord(view.configJson) ? view.configJson : {};
    return {
      filter: config.filter,
      sort: config.sort,
      visiblePropertyIds: Array.isArray(config.visiblePropertyIds)
        ? config.visiblePropertyIds.filter(
            (propertyId): propertyId is string =>
              typeof propertyId === 'string',
          )
        : undefined,
    };
  }

  private async validateRead(
    dataSource: DataSource,
    user: User,
  ): Promise<void> {
    await this.permissionService.validateRead(dataSource, user);
  }

  private async validateWrite(
    dataSource: DataSource,
    user: User,
  ): Promise<void> {
    await this.permissionService.validateWrite(dataSource, user);
  }

  private async validatePersonUserIds(
    userIds: string[],
    user: User,
    trx: KyselyTransaction,
  ): Promise<void> {
    const uniqueUserIds = Array.from(new Set(userIds));
    if (uniqueUserIds.length === 0) return;
    const workspaceUsers = await this.userRepo.findByIds(
      uniqueUserIds,
      user.workspaceId,
      { trx },
    );
    if (workspaceUsers.length !== uniqueUserIds.length) {
      throw new BadRequestException('User not found');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTextFilterType(type: string): boolean {
  return [
    DataSourcePropertyType.Title,
    DataSourcePropertyType.Text,
    DataSourcePropertyType.Url,
    DataSourcePropertyType.Email,
    DataSourcePropertyType.Phone,
  ].includes(type as DataSourcePropertyType);
}

function isSupportedFilterOperator(type: string, operator: string): boolean {
  if (isTextFilterType(type)) {
    return ['equals', 'contains', 'is_empty', 'is_not_empty'].includes(
      operator,
    );
  }
  if (type === DataSourcePropertyType.Number) {
    return [
      'equals',
      'greater_than',
      'less_than',
      'is_empty',
      'is_not_empty',
    ].includes(operator);
  }
  if (type === DataSourcePropertyType.Checkbox) {
    return operator === 'equals';
  }
  if (type === DataSourcePropertyType.Date) {
    return ['equals', 'before', 'after', 'is_empty', 'is_not_empty'].includes(
      operator,
    );
  }
  if (type === DataSourcePropertyType.Select) {
    return ['equals', 'is_empty', 'is_not_empty'].includes(operator);
  }
  return false;
}

function operatorRequiresValue(operator: string): boolean {
  return operator !== 'is_empty' && operator !== 'is_not_empty';
}

function isSupportedSortType(type: string): boolean {
  return [
    DataSourcePropertyType.Title,
    DataSourcePropertyType.Text,
    DataSourcePropertyType.Url,
    DataSourcePropertyType.Email,
    DataSourcePropertyType.Phone,
    DataSourcePropertyType.Number,
    DataSourcePropertyType.Checkbox,
    DataSourcePropertyType.Date,
    DataSourcePropertyType.Select,
  ].includes(type as DataSourcePropertyType);
}

function normalizeFilterValue(
  property: DataSourceProperty,
  operator: string,
  value: unknown,
): unknown {
  const normalized = normalizePropertyValue({
    type: property.type,
    value,
    config: property.configJson as Record<string, any>,
    allowArchivedSelectOptions: true,
  });

  if (property.type === DataSourcePropertyType.Number) {
    return normalized.numberValue;
  }
  if (property.type === DataSourcePropertyType.Checkbox) {
    return normalized.boolValue;
  }
  if (property.type === DataSourcePropertyType.Date) {
    if (operator === 'equals') {
      return normalized.valueJson;
    }
    return normalized.dateValue;
  }
  return normalized.textValue;
}

function validatePosition(position: string | undefined): string | undefined {
  if (position === undefined) return undefined;
  try {
    generateJitteredKeyBetween(position, null);
    return position;
  } catch {
    throw new BadRequestException('Invalid position');
  }
}

type RecordValueResponse = {
  id: string;
  propertyId: string;
  value: unknown;
  version: number;
  updatedAt: Date;
};

type RecordResponse = {
  id: string;
  databaseId: string;
  pageId: string | null;
  position: string;
  version: number;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  values: Record<string, RecordValueResponse>;
};

type ViewQueryConfig = {
  filter?: unknown;
  sort?: unknown;
  visiblePropertyIds?: string[];
};

type DataSourcePropertyValueInsert = Omit<
  InsertableDataSourcePropertyValue,
  'version'
> & {
  personUserIds: string[];
};

function toRecordValueResponse(
  value: Pick<
    DataSourcePropertyValue,
    'id' | 'propertyId' | 'valueJson' | 'version' | 'updatedAt'
  >,
): RecordValueResponse {
  return {
    id: value.id,
    propertyId: value.propertyId,
    value: value.valueJson,
    version: value.version,
    updatedAt: value.updatedAt,
  };
}

function toRecordResponse(
  record: DataSourceRecord,
  values: Record<string, RecordValueResponse>,
): RecordResponse {
  return {
    id: record.id,
    databaseId: record.dataSourceId,
    pageId: record.pageId,
    position: record.position,
    version: record.version,
    createdById: record.createdById,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    values,
  };
}
