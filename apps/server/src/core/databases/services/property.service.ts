import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { DataSourcePropertyRepo } from '@docmost/db/repos/data-source/data-source-property.repo';
import { DataSourcePropertyValueRepo } from '@docmost/db/repos/data-source/data-source-property-value.repo';
import { DataSourceRepo } from '@docmost/db/repos/data-source/data-source.repo';
import { DataSourceProperty, User } from '@docmost/db/types/entity.types';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import {
  CreatePropertyDto,
  UpdatePropertyDto,
} from '../dto/property.dto';
import { DatabasePermissionService } from './database-permission.service';
import { DataSourcePropertyType } from './property-value-normalizer';

@Injectable()
export class PropertyService {
  constructor(
    private readonly dataSourceRepo: DataSourceRepo,
    private readonly propertyRepo: DataSourcePropertyRepo,
    private readonly propertyValueRepo: DataSourcePropertyValueRepo,
    private readonly permissionService: DatabasePermissionService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async create(
    dto: CreatePropertyDto,
    user: User,
  ): Promise<DataSourceProperty> {
    if (dto.type === DataSourcePropertyType.Title) {
      throw new BadRequestException('Title property cannot be created');
    }
    const dataSource = await this.findActiveDataSource(dto.databaseId);
    await this.permissionService.validateWrite(dataSource, user);
    const lastPosition = await this.propertyRepo.findLastPosition(
      dataSource.id,
    );
    return this.propertyRepo.insert({
      dataSourceId: dataSource.id,
      name: dto.name,
      type: dto.type,
      configJson: (dto.config ?? {}) as any,
      position:
        dto.position ?? generateJitteredKeyBetween(lastPosition ?? null, null),
      createdById: user.id,
    });
  }

  async update(
    dto: UpdatePropertyDto,
    user: User,
  ): Promise<DataSourceProperty> {
    const property = await this.findActiveProperty(dto.propertyId);
    const dataSource = await this.findActiveDataSource(property.dataSourceId);
    await this.permissionService.validateWrite(dataSource, user);
    const updated = await this.propertyRepo.update(property.id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.config !== undefined ? { configJson: dto.config as any } : {}),
      ...(dto.position !== undefined ? { position: dto.position } : {}),
    });
    if (!updated) throw new NotFoundException('Property not found');
    return updated;
  }

  async delete(propertyId: string, user: User): Promise<void> {
    const property = await this.findActiveProperty(propertyId);
    const dataSource = await this.findActiveDataSource(property.dataSourceId);
    await this.permissionService.validateWrite(dataSource, user);
    if (property.type === DataSourcePropertyType.Title) {
      throw new BadRequestException('Title property cannot be deleted');
    }
    await executeTx(this.db, async (trx) => {
      await this.propertyRepo.softDelete(property.id, trx);
      await this.propertyValueRepo.softDeleteByPropertyId(property.id, trx);
    });
  }

  private async findActiveDataSource(databaseId: string) {
    const dataSource = await this.dataSourceRepo.findActiveById(databaseId);
    if (!dataSource) throw new NotFoundException('Database not found');
    return dataSource;
  }

  private async findActiveProperty(propertyId: string) {
    const property = await this.propertyRepo.findActiveById(propertyId);
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }
}
