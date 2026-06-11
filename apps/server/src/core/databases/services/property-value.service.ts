import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { DataSourcePropertyRepo } from '@docmost/db/repos/data-source/data-source-property.repo';
import { DataSourcePropertyValueRepo } from '@docmost/db/repos/data-source/data-source-property-value.repo';
import { DataSourceRecordRepo } from '@docmost/db/repos/data-source/data-source-record.repo';
import { DataSourceRepo } from '@docmost/db/repos/data-source/data-source.repo';
import { DataSourcePropertyValue, User } from '@docmost/db/types/entity.types';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { UpdatePropertyValueDto } from '../dto/property-value.dto';
import { DatabasePermissionService } from './database-permission.service';
import { normalizePropertyValue } from './property-value-normalizer';

@Injectable()
export class PropertyValueService {
  constructor(
    private readonly dataSourceRepo: DataSourceRepo,
    private readonly recordRepo: DataSourceRecordRepo,
    private readonly propertyRepo: DataSourcePropertyRepo,
    private readonly propertyValueRepo: DataSourcePropertyValueRepo,
    private readonly permissionService: DatabasePermissionService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async update(
    dto: UpdatePropertyValueDto,
    user: User,
  ): Promise<DataSourcePropertyValue> {
    const record = await this.recordRepo.findActiveById(dto.recordId);
    if (!record) throw new NotFoundException('Record not found');
    const property = await this.propertyRepo.findActiveById(dto.propertyId);
    if (!property) throw new NotFoundException('Property not found');
    if (record.dataSourceId !== property.dataSourceId) {
      throw new BadRequestException('Property does not belong to record');
    }
    const dataSource = await this.dataSourceRepo.findActiveById(
      record.dataSourceId,
    );
    if (!dataSource) throw new NotFoundException('Database not found');
    await this.permissionService.validateWrite(dataSource, user);
    const normalized = normalizePropertyValue({
      type: property.type,
      value: dto.value,
      config: property.configJson as Record<string, any>,
    });
    return executeTx(this.db, async (trx) => {
      const value = await this.propertyValueRepo.upsert(
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
      await this.recordRepo.incrementVersion(record.id, trx);
      return value;
    });
  }
}
