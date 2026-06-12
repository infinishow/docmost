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
import { DataSourceViewRepo } from '@docmost/db/repos/data-source/data-source-view.repo';
import {
  DataSource,
  DataSourceProperty,
  User,
} from '@docmost/db/types/entity.types';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { CreatePropertyDto, UpdatePropertyDto } from '../dto/property.dto';
import { DatabasePermissionService } from './database-permission.service';
import { DataSourcePropertyType } from './property-value-normalizer';

@Injectable()
export class PropertyService {
  constructor(
    private readonly dataSourceRepo: DataSourceRepo,
    private readonly propertyRepo: DataSourcePropertyRepo,
    private readonly viewRepo: DataSourceViewRepo,
    private readonly propertyValueRepo: DataSourcePropertyValueRepo,
    private readonly permissionService: DatabasePermissionService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async create(
    dto: CreatePropertyDto,
    user: User,
  ): Promise<DataSourcePropertyResponse> {
    if (dto.type === DataSourcePropertyType.Title) {
      throw new BadRequestException('Title property cannot be created');
    }
    const dataSource = await this.findActiveDataSource(dto.databaseId);
    await this.validateWrite(dataSource, user);
    const lastPosition = await this.propertyRepo.findLastPosition(
      dataSource.id,
    );
    const property = await this.propertyRepo.insert({
      dataSourceId: dataSource.id,
      name: dto.name,
      type: dto.type,
      configJson: validatePropertyConfig(dto.type, dto.config),
      position:
        validatePosition(dto.position) ??
        generateJitteredKeyBetween(lastPosition ?? null, null),
      createdById: user.id,
    });
    return toDataSourcePropertyResponse(property);
  }

  async update(
    dto: UpdatePropertyDto,
    user: User,
  ): Promise<DataSourcePropertyResponse> {
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
    return toDataSourcePropertyResponse(updated);
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
      await this.removePropertyFromViewConfigs(
        property.dataSourceId,
        property.id,
        trx,
      );
    });
  }

  private async removePropertyFromViewConfigs(
    dataSourceId: string,
    propertyId: string,
    trx: KyselyTransaction,
  ): Promise<void> {
    const views = await this.viewRepo.findActiveByDataSource(dataSourceId, trx);
    for (const view of views) {
      const sanitized = removePropertyReferences(view.configJson, propertyId);
      if (sanitized.changed) {
        await this.viewRepo.update(
          view.id,
          { configJson: sanitized.config },
          trx,
        );
      }
    }
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

  private async validateWrite(
    dataSource: DataSource,
    user: User,
  ): Promise<void> {
    await this.permissionService.validateWrite(dataSource, user);
  }
}

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

function removePropertyReferences(
  config: unknown,
  propertyId: string,
): { config: Record<string, any>; changed: boolean } {
  const input = isConfigRecord(config) ? config : {};
  const next: Record<string, any> = { ...input };
  let changed = false;

  if (Array.isArray(input.visiblePropertyIds)) {
    next.visiblePropertyIds = input.visiblePropertyIds.filter(
      (id) => id !== propertyId,
    );
    changed ||=
      next.visiblePropertyIds.length !== input.visiblePropertyIds.length;
  }

  if (Array.isArray(input.propertyOrder)) {
    next.propertyOrder = input.propertyOrder.filter((id) => id !== propertyId);
    changed ||= next.propertyOrder.length !== input.propertyOrder.length;
  }

  const filterResult = removePropertyFromFilter(input.filter, propertyId);
  if (filterResult.changed) {
    next.filter = filterResult.filter ?? null;
    changed = true;
  }

  const sortResult = removePropertyFromSort(input.sort, propertyId);
  if (sortResult.changed) {
    next.sort = sortResult.sort;
    changed = true;
  }

  return { config: next, changed };
}

function removePropertyFromFilter(
  filter: unknown,
  propertyId: string,
): { filter?: unknown; changed: boolean } {
  if (!isConfigRecord(filter)) return { filter, changed: false };

  if (Array.isArray(filter.and) || Array.isArray(filter.or)) {
    const key = Array.isArray(filter.and) ? 'and' : 'or';
    const children = filter[key] as unknown[];
    let changed = false;
    const nextChildren: unknown[] = [];

    for (const child of children) {
      const result = removePropertyFromFilter(child, propertyId);
      changed ||= result.changed;
      if (result.filter !== undefined) {
        nextChildren.push(result.filter);
      }
    }

    if (nextChildren.length !== children.length) changed = true;
    if (!changed) return { filter, changed: false };
    if (nextChildren.length === 0) return { filter: undefined, changed: true };
    if (nextChildren.length === 1) {
      return { filter: nextChildren[0], changed: true };
    }
    return { filter: { ...filter, [key]: nextChildren }, changed: true };
  }

  if (filter.propertyId === propertyId) {
    return { filter: undefined, changed: true };
  }
  return { filter, changed: false };
}

function removePropertyFromSort(
  sort: unknown,
  propertyId: string,
): { sort: unknown; changed: boolean } {
  if (Array.isArray(sort)) {
    const next = sort.filter(
      (item) => !isConfigRecord(item) || item.propertyId !== propertyId,
    );
    return {
      sort: next,
      changed: next.length !== sort.length,
    };
  }

  if (isConfigRecord(sort) && sort.propertyId === propertyId) {
    return { sort: [], changed: true };
  }

  return { sort, changed: false };
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
