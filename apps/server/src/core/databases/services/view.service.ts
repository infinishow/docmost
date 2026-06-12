import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { DataSourcePropertyRepo } from '@docmost/db/repos/data-source/data-source-property.repo';
import { DataSourceRepo } from '@docmost/db/repos/data-source/data-source.repo';
import { DataSourceViewRepo } from '@docmost/db/repos/data-source/data-source-view.repo';
import {
  DataSourceProperty,
  DataSourceView,
  User,
} from '@docmost/db/types/entity.types';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { CreateViewDto, UpdateViewDto } from '../dto/view.dto';
import { DatabasePermissionService } from './database-permission.service';
import {
  DataSourcePropertyType,
  normalizePropertyValue,
} from './property-value-normalizer';

@Injectable()
export class ViewService {
  constructor(
    private readonly dataSourceRepo: DataSourceRepo,
    private readonly propertyRepo: DataSourcePropertyRepo,
    private readonly viewRepo: DataSourceViewRepo,
    private readonly permissionService: DatabasePermissionService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async create(dto: CreateViewDto, user: User): Promise<DataSourceViewResponse> {
    if (dto.type !== 'table') {
      throw new BadRequestException('Only table views are supported');
    }
    const dataSource = await this.findActiveDataSource(dto.databaseId);
    await this.validateWrite(dataSource, user);
    const properties = await this.propertyRepo.findActiveByDataSource(
      dataSource.id,
    );
    const lastPosition = await this.viewRepo.findLastPosition(dataSource.id);
    const view = await this.viewRepo.insert({
      dataSourceId: dataSource.id,
      name: dto.name,
      type: dto.type,
      configJson: normalizeViewConfig(dto.config, properties),
      position:
        validatePosition(dto.position) ??
        generateJitteredKeyBetween(lastPosition ?? null, null),
      createdById: user.id,
    });
    return toDataSourceViewResponse(view);
  }

  async update(dto: UpdateViewDto, user: User): Promise<DataSourceViewResponse> {
    const view = await this.findActiveView(dto.viewId);
    const dataSource = await this.findActiveDataSource(view.dataSourceId);
    await this.validateWrite(dataSource, user);
    const properties = await this.propertyRepo.findActiveByDataSource(
      dataSource.id,
    );
    const updated = await this.viewRepo.update(view.id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.config !== undefined
        ? { configJson: normalizeViewConfig(dto.config, properties) }
        : {}),
      ...(dto.position !== undefined
        ? { position: validatePosition(dto.position) }
        : {}),
    });
    if (!updated) throw new NotFoundException('View not found');
    return toDataSourceViewResponse(updated);
  }

  async delete(viewId: string, user: User): Promise<void> {
    const view = await this.findActiveView(viewId);
    const dataSource = await this.findActiveDataSource(view.dataSourceId);
    await this.validateWrite(dataSource, user);
    await executeTx(this.db, async (trx) => {
      await trx
        .selectFrom('dataSources')
        .select('id')
        .where('id', '=', dataSource.id)
        .forUpdate()
        .executeTakeFirst();

      const count = await this.viewRepo.countActiveByDataSource(
        dataSource.id,
        trx,
      );
      if (count <= 1) {
        throw new BadRequestException('Cannot delete the last view');
      }
      await this.viewRepo.softDelete(view.id, trx);
    });
  }

  private async findActiveDataSource(databaseId: string) {
    const dataSource = await this.dataSourceRepo.findActiveById(databaseId);
    if (!dataSource) throw new NotFoundException('Database not found');
    return dataSource;
  }

  private async findActiveView(viewId: string) {
    const view = await this.viewRepo.findActiveById(viewId);
    if (!view) throw new NotFoundException('View not found');
    return view;
  }

  private async validateWrite(dataSource: any, user: User): Promise<void> {
    await this.permissionService.validateWrite(dataSource, user);
  }
}

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

function normalizeViewConfig(
  config: unknown,
  properties: DataSourceProperty[],
): Record<string, any> {
  const input =
    typeof config === 'object' && config !== null && !Array.isArray(config)
      ? (config as Record<string, any>)
      : {};
  const propertyById = new Map(properties.map((property) => [property.id, property]));
  validatePropertyIdList(input.visiblePropertyIds, propertyById);
  validatePropertyIdList(input.propertyOrder, propertyById);
  validateFilter(input.filter, propertyById);
  validateSort(input.sort, propertyById);
  return {
    visiblePropertyIds: Array.isArray(input.visiblePropertyIds)
      ? input.visiblePropertyIds
      : [],
    propertyOrder: Array.isArray(input.propertyOrder)
      ? input.propertyOrder
      : [],
    filter: input.filter ?? null,
    sort: Array.isArray(input.sort) ? input.sort : [],
  };
}

function validatePropertyIdList(
  value: unknown,
  propertyById: Map<string, DataSourceProperty>,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new BadRequestException('Invalid view property ids');
  }
  for (const propertyId of value) {
    if (!propertyById.has(propertyId)) {
      throw new BadRequestException('View property not found');
    }
  }
}

function validateFilter(
  filter: unknown,
  propertyById: Map<string, DataSourceProperty>,
): void {
  if (filter === undefined || filter === null) return;
  validateFilterNode(filter, propertyById, 1, { value: 0 });
}

function validateFilterNode(
  filter: unknown,
  propertyById: Map<string, DataSourceProperty>,
  depth: number,
  leafCount: { value: number },
): void {
  if (!isRecord(filter)) throw new BadRequestException('Invalid filter');
  if (depth > 3) throw new BadRequestException('Filter is too deeply nested');
  if (Array.isArray(filter.and) || Array.isArray(filter.or)) {
    const children = Array.isArray(filter.and) ? filter.and : filter.or;
    if (!Array.isArray(children) || children.length === 0) {
      throw new BadRequestException('Invalid filter group');
    }
    for (const child of children) {
      validateFilterNode(child, propertyById, depth + 1, leafCount);
    }
    return;
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
  if (!isSupportedFilterOperator(property.type, operator)) {
    throw new BadRequestException('Unsupported filter operator');
  }
  if (operator !== 'is_empty' && operator !== 'is_not_empty') {
    normalizePropertyValue({
      type: property.type,
      value,
      config: property.configJson as Record<string, any>,
      allowArchivedSelectOptions: true,
    });
  }
}

function validateSort(
  sort: unknown,
  propertyById: Map<string, DataSourceProperty>,
): void {
  if (sort === undefined || sort === null) return;
  const sortItems = Array.isArray(sort) ? sort : [sort];
  if (sortItems.length > 3) {
    throw new BadRequestException('Too many sort conditions');
  }
  for (const item of sortItems) {
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
  }
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
  if (type === DataSourcePropertyType.Checkbox) return operator === 'equals';
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

function isTextFilterType(type: string): boolean {
  return [
    DataSourcePropertyType.Title,
    DataSourcePropertyType.Text,
    DataSourcePropertyType.Url,
    DataSourcePropertyType.Email,
    DataSourcePropertyType.Phone,
  ].includes(type as DataSourcePropertyType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
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
