import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { DataSourcePropertyRepo } from '@docmost/db/repos/data-source/data-source-property.repo';
import { DataSourcePropertyValueRepo } from '@docmost/db/repos/data-source/data-source-property-value.repo';
import {
  DataSourceRecordQueryFilter,
  DataSourceRecordQueryOptions,
  DataSourceRecordQuerySort,
  DataSourceRecordRepo,
} from '@docmost/db/repos/data-source/data-source-record.repo';
import { DataSourceRepo } from '@docmost/db/repos/data-source/data-source.repo';
import {
  DataSourceProperty,
  DataSourcePropertyValue,
  DataSourceRecord,
  User,
} from '@docmost/db/types/entity.types';
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
    private readonly propertyValueRepo: DataSourcePropertyValueRepo,
    private readonly permissionService: DatabasePermissionService,
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
            dto.position ??
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
        for (const [propertyId, value] of Object.entries(dto.values)) {
          const property = propertyById.get(propertyId);
          if (!property) {
            throw new BadRequestException(
              'Property does not belong to database',
            );
          }
          values.push(
            await this.upsertValue(record, property, value, user, trx),
          );
        }
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
      ...(dto.position !== undefined ? { position: dto.position } : {}),
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
    if (dto.viewId) {
      throw new BadRequestException(
        'View queries are not supported in phase one',
      );
    }
    const properties = await this.propertyRepo.findActiveByDataSource(
      dataSource.id,
    );
    const queryConfig = this.buildQueryConfig(dto, properties);
    const result = await this.recordRepo.query({
      databaseId: dataSource.id,
      limit: dto.limit ?? 50,
      cursor: dto.cursor,
      ...queryConfig,
    });
    const recordIds = result.items.map((record) => record.id);
    const values = await this.findValuesByRecordIds(recordIds);
    const valuesByRecordId = new Map<
      string,
      Record<string, RecordValueResponse>
    >();
    for (const value of values) {
      const bucket = valuesByRecordId.get(value.recordId) ?? {};
      bucket[value.propertyId] = toRecordValueResponse(value);
      valuesByRecordId.set(value.recordId, bucket);
    }
    return {
      ...result,
      items: result.items.map((record) => ({
        ...record,
        values: valuesByRecordId.get(record.id) ?? {},
      })),
    };
  }

  private async upsertValue(
    record: DataSourceRecord,
    property: DataSourceProperty,
    value: unknown,
    user: User,
    trx: KyselyTransaction,
  ): Promise<DataSourcePropertyValue> {
    const normalized = normalizePropertyValue({
      type: property.type,
      value,
      config: property.configJson as Record<string, any>,
    });
    return this.propertyValueRepo.upsert(
      {
        dataSourceId: record.dataSourceId,
        recordId: record.id,
        propertyId: property.id,
        createdById: user.id,
        lastEditedById: user.id,
        ...normalized,
      } as any,
      trx,
    );
  }

  private async findValuesByRecordIds(recordIds: string[]) {
    return this.recordRepo.findValuesByRecordIds(recordIds);
  }

  private buildQueryConfig(
    dto: QueryRecordsDto,
    properties: DataSourceProperty[],
  ): Pick<DataSourceRecordQueryOptions, 'filter' | 'sort'> {
    const propertyById = new Map(properties.map((item) => [item.id, item]));
    const filter = this.buildFilter(dto.filter, propertyById);
    const sort = this.buildSort(dto.sort, propertyById);
    if (dto.cursor && sort) {
      throw new BadRequestException(
        'Sorted cursor pagination is not supported in phase one',
      );
    }
    return {
      ...(filter ? { filter } : {}),
      ...(sort ? { sort } : {}),
    };
  }

  private buildFilter(
    filter: unknown,
    propertyById: Map<string, DataSourceProperty>,
  ): DataSourceRecordQueryFilter | undefined {
    if (filter === undefined || filter === null) return undefined;
    if (!isRecord(filter)) throw new BadRequestException('Invalid filter');

    const { propertyId, operator, value } = filter;
    if (typeof propertyId !== 'string') {
      throw new BadRequestException('Invalid filter property');
    }
    if (operator !== 'contains' && operator !== 'equals') {
      throw new BadRequestException('Invalid filter operator');
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

    return {
      propertyId,
      type: property.type,
      operator,
      value:
        operator === 'equals' ? normalizeFilterValue(property, value) : value,
    };
  }

  private buildSort(
    sort: unknown,
    propertyById: Map<string, DataSourceProperty>,
  ): DataSourceRecordQuerySort | undefined {
    if (sort === undefined || sort === null) return undefined;
    if (!isRecord(sort)) throw new BadRequestException('Invalid sort');

    const { propertyId, direction = 'asc' } = sort;
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

  private async validateRead(dataSource: any, user: User): Promise<void> {
    try {
      await this.permissionService.validateRead(dataSource, user);
    } catch (err) {
      if (err instanceof ForbiddenException) {
        throw new NotFoundException('Record not found');
      }
      throw err;
    }
  }

  private async validateWrite(dataSource: any, user: User): Promise<void> {
    try {
      await this.permissionService.validateWrite(dataSource, user);
    } catch (err) {
      if (err instanceof ForbiddenException) {
        throw new NotFoundException('Record not found');
      }
      throw err;
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
  value: unknown,
): unknown {
  const normalized = normalizePropertyValue({
    type: property.type,
    value,
    config: property.configJson as Record<string, any>,
  });

  if (property.type === DataSourcePropertyType.Number) {
    return normalized.numberValue;
  }
  if (property.type === DataSourcePropertyType.Checkbox) {
    return normalized.boolValue;
  }
  if (property.type === DataSourcePropertyType.Date) {
    return normalized.dateValue;
  }
  return normalized.textValue;
}

type RecordValueResponse = {
  id: string;
  propertyId: string;
  value: unknown;
  version: number;
  updatedAt: Date;
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
