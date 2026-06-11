import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { DataSourcePropertyRepo } from '@docmost/db/repos/data-source/data-source-property.repo';
import { DataSourcePropertyValueRepo } from '@docmost/db/repos/data-source/data-source-property-value.repo';
import { DataSourceRecordRepo } from '@docmost/db/repos/data-source/data-source-record.repo';
import { DataSourceRepo } from '@docmost/db/repos/data-source/data-source.repo';
import {
  DataSourceProperty,
  DataSourceRecord,
  User,
} from '@docmost/db/types/entity.types';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { CreateRecordDto, UpdateRecordDto } from '../dto/record.dto';
import { QueryRecordsDto } from '../dto/query.dto';
import { DatabasePermissionService } from './database-permission.service';
import { normalizePropertyValue } from './property-value-normalizer';

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

  async create(dto: CreateRecordDto, user: User): Promise<DataSourceRecord> {
    const dataSource = await this.findActiveDataSource(dto.databaseId);
    await this.permissionService.validateWrite(dataSource, user);
    return executeTx(this.db, async (trx) => {
      const lastPosition = await this.recordRepo.findLastPosition(
        dataSource.id,
        trx,
      );
      const record = await this.recordRepo.insert(
        {
          dataSourceId: dataSource.id,
          position:
            dto.position ?? generateJitteredKeyBetween(lastPosition ?? null, null),
          createdById: user.id,
        },
        trx,
      );
      if (dto.values) {
        const properties = await this.propertyRepo.findActiveByDataSource(
          dataSource.id,
          trx,
        );
        const propertyById = new Map(properties.map((item) => [item.id, item]));
        for (const [propertyId, value] of Object.entries(dto.values)) {
          const property = propertyById.get(propertyId);
          if (!property) {
            throw new BadRequestException('Property does not belong to database');
          }
          await this.upsertValue(record, property, value, user, trx);
        }
      }
      return record;
    });
  }

  async update(dto: UpdateRecordDto, user: User): Promise<DataSourceRecord> {
    const record = await this.findActiveRecord(dto.recordId);
    const dataSource = await this.findActiveDataSource(record.dataSourceId);
    await this.permissionService.validateWrite(dataSource, user);
    const updated = await this.recordRepo.update(record.id, {
      ...(dto.position !== undefined ? { position: dto.position } : {}),
    });
    if (!updated) throw new NotFoundException('Record not found');
    return updated;
  }

  async delete(recordId: string, user: User): Promise<void> {
    const record = await this.findActiveRecord(recordId);
    const dataSource = await this.findActiveDataSource(record.dataSourceId);
    await this.permissionService.validateWrite(dataSource, user);
    await executeTx(this.db, async (trx) => {
      await this.recordRepo.softDelete(record.id, trx);
      await this.propertyValueRepo.softDeleteByRecordId(record.id, trx);
    });
  }

  async query(dto: QueryRecordsDto, user: User) {
    const dataSource = await this.findActiveDataSource(dto.databaseId);
    await this.permissionService.validateRead(dataSource, user);
    const result = await this.recordRepo.findActiveByDataSource(dataSource.id, {
      limit: dto.limit ?? 50,
      cursor: dto.cursor,
      query: '',
      adminView: false,
    });
    const recordIds = result.items.map((record) => record.id);
    const values = await this.propertyValueRepoSoftLookup(recordIds);
    const valuesByRecordId = new Map<string, typeof values>();
    for (const value of values) {
      const bucket = valuesByRecordId.get(value.recordId) ?? [];
      bucket.push(value);
      valuesByRecordId.set(value.recordId, bucket);
    }
    return {
      ...result,
      items: result.items.map((record) => ({
        ...record,
        values: valuesByRecordId.get(record.id) ?? [],
      })),
    };
  }

  private async upsertValue(
    record: DataSourceRecord,
    property: DataSourceProperty,
    value: unknown,
    user: User,
    trx: any,
  ) {
    const normalized = normalizePropertyValue({
      type: property.type,
      value,
      config: property.configJson as Record<string, any>,
    });
    await this.propertyValueRepo.upsert(
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

  private async propertyValueRepoSoftLookup(recordIds: string[]) {
    return this.recordRepo.findValuesByRecordIds(recordIds);
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
}
