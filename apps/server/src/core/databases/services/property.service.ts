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
    await this.validateWrite(dataSource, user);
    const lastPosition = await this.propertyRepo.findLastPosition(
      dataSource.id,
    );
    return this.propertyRepo.insert({
      dataSourceId: dataSource.id,
      name: dto.name,
      type: dto.type,
      configJson: validatePropertyConfig(dto.type, dto.config),
      position:
        validatePosition(dto.position) ??
        generateJitteredKeyBetween(lastPosition ?? null, null),
      createdById: user.id,
    });
  }

  async update(
    dto: UpdatePropertyDto,
    user: User,
  ): Promise<DataSourceProperty> {
    const property = await this.findActiveProperty(dto.propertyId);
    const dataSource = await this.findActiveDataSource(property.dataSourceId);
    await this.validateWrite(dataSource, user);
    const updated = await this.propertyRepo.update(property.id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.config !== undefined
        ? { configJson: validatePropertyConfig(property.type, dto.config) }
        : {}),
      ...(dto.position !== undefined
        ? { position: validatePosition(dto.position) }
        : {}),
    });
    if (!updated) throw new NotFoundException('Property not found');
    return updated;
  }

  async delete(propertyId: string, user: User): Promise<void> {
    const property = await this.findActiveProperty(propertyId);
    const dataSource = await this.findActiveDataSource(property.dataSourceId);
    await this.validateWrite(dataSource, user);
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

  private async validateWrite(dataSource: any, user: User): Promise<void> {
    await this.permissionService.validateWrite(dataSource, user);
  }
}

function validatePropertyConfig(
  type: string,
  config: unknown,
): Record<string, any> {
  const normalized = isConfigRecord(config) ? config : {};
  if (
    type !== DataSourcePropertyType.Select &&
    type !== DataSourcePropertyType.MultiSelect
  ) {
    return normalized;
  }

  if (!Array.isArray(normalized.options)) {
    return { ...normalized, options: [] };
  }

  const optionIds = new Set<string>();
  for (const option of normalized.options) {
    if (
      !isConfigRecord(option) ||
      typeof option.id !== 'string' ||
      typeof option.name !== 'string' ||
      typeof option.sortKey !== 'string' ||
      (option.color !== undefined && typeof option.color !== 'string') ||
      (option.archived !== undefined && typeof option.archived !== 'boolean')
    ) {
      throw new BadRequestException('Invalid select option config');
    }
    if (optionIds.has(option.id)) {
      throw new BadRequestException('Duplicate select option id');
    }
    optionIds.add(option.id);
  }

  return normalized;
}

function isConfigRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
