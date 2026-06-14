import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CreateRecordDto } from '../dto/record.dto';
import { QueryRecordsDto } from '../dto/query.dto';
import { DataSourcePropertyType } from './property-value-normalizer';
import { RecordService } from './record.service';

describe('RecordService', () => {
  const dataSourceRepo = { findActiveById: jest.fn() };
  const recordRepo = {
    findLastPosition: jest.fn(),
    insert: jest.fn(),
    findActiveById: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    incrementVersion: jest.fn(),
    findActiveByDataSource: jest.fn(),
    query: jest.fn(),
    findValuesByRecordIds: jest.fn(),
  };
  const propertyRepo = { findActiveByDataSource: jest.fn() };
  const viewRepo = { findActiveById: jest.fn() };
  const propertyValueRepo = {
    upsert: jest.fn(),
    upsertMany: jest.fn(),
    softDeleteByRecordId: jest.fn(),
  };
  const permissionService = {
    validateWrite: jest.fn(),
    validateRead: jest.fn(),
  };
  const userRepo = { findById: jest.fn(), findByIds: jest.fn() };
  const db = { transaction: () => ({ execute: (cb: any) => cb('trx') }) };
  const service = new RecordService(
    dataSourceRepo as any,
    recordRepo as any,
    propertyRepo as any,
    viewRepo as any,
    propertyValueRepo as any,
    permissionService as any,
    userRepo as any,
    db as any,
  );
  const user = { id: 'user-1', workspaceId: 'workspace-1' } as any;
  const databaseId = 'database-1';
  const dataSource = { id: databaseId, parentPageId: 'page-1' } as any;
  const record = { id: 'record-1', dataSourceId: databaseId } as any;
  const property = {
    id: 'property-1',
    dataSourceId: databaseId,
    type: 'text',
    configJson: {},
  } as any;
  const numberProperty = {
    id: 'property-number',
    dataSourceId: databaseId,
    type: DataSourcePropertyType.Number,
    configJson: {},
  } as any;
  const dateProperty = {
    id: 'property-date',
    dataSourceId: databaseId,
    type: DataSourcePropertyType.Date,
    configJson: {},
  } as any;
  const multiSelectProperty = {
    id: 'property-multi',
    dataSourceId: databaseId,
    type: DataSourcePropertyType.MultiSelect,
    configJson: {},
  } as any;
  const selectProperty = {
    id: 'property-select',
    dataSourceId: databaseId,
    type: DataSourcePropertyType.Select,
    configJson: {
      options: [{ id: 'todo', name: 'Todo', sortKey: '001' }],
    },
  } as any;
  const archivedSelectProperty = {
    ...selectProperty,
    id: 'property-archived-select',
    configJson: {
      options: [
        { id: 'old', name: 'Old', sortKey: '999', archived: true },
      ],
    },
  } as any;
  const personProperty = {
    id: 'property-person',
    dataSourceId: databaseId,
    type: DataSourcePropertyType.Person,
    configJson: {},
  } as any;
  const foreignPropertyId = 'foreign-property';

  beforeEach(() => jest.clearAllMocks());

  it('rejects values for properties outside the database', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    recordRepo.insert.mockResolvedValue(record);
    propertyRepo.findActiveByDataSource.mockResolvedValue([property]);

    await expect(
      service.create(
        { databaseId, values: { [foreignPropertyId]: 'x' } },
        user,
      ),
    ).rejects.toThrow();
  });

  it('bulk upserts initial values when creating a record', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    recordRepo.insert.mockResolvedValue(record);
    propertyRepo.findActiveByDataSource.mockResolvedValue([property]);
    propertyValueRepo.upsertMany.mockResolvedValue([
      {
        id: 'value-1',
        propertyId: property.id,
        valueJson: 'x',
        version: 1,
        updatedAt: new Date('2026-06-11T00:00:00.000Z'),
      },
    ]);

    const result = await service.create(
      { databaseId, values: { [property.id]: 'x' } },
      user,
    );

    expect(propertyValueRepo.upsertMany).toHaveBeenCalledWith(
      [expect.objectContaining({ recordId: record.id })],
      expect.anything(),
    );
    expect(recordRepo.incrementVersion).toHaveBeenCalledWith(
      record.id,
      expect.anything(),
    );
    expect(result).toMatchObject({
      record: expect.objectContaining({ id: record.id }),
      values: [
        expect.objectContaining({
          propertyId: property.id,
          value: 'x',
        }),
      ],
    });
  });

  it('returns queried values keyed by property id', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    propertyRepo.findActiveByDataSource.mockResolvedValue([property]);
    recordRepo.query.mockResolvedValue({
      items: [record],
      meta: { hasNextPage: false },
    });
    recordRepo.findValuesByRecordIds.mockResolvedValue([
      {
        id: 'value-1',
        recordId: record.id,
        propertyId: property.id,
        valueJson: 'x',
        version: 1,
        updatedAt: new Date('2026-06-11T00:00:00.000Z'),
      },
    ]);

    const result = await service.query({ databaseId }, user);

    expect(recordRepo.query).toHaveBeenCalledWith({
      databaseId,
      cursor: undefined,
      limit: 50,
    });
    expect(result.items[0].values).toEqual({
      [property.id]: {
        id: 'value-1',
        propertyId: property.id,
        value: 'x',
        version: 1,
        updatedAt: new Date('2026-06-11T00:00:00.000Z'),
      },
    });
  });

  it('strips internal sort cursor helper fields from queried records', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    propertyRepo.findActiveByDataSource.mockResolvedValue([property]);
    recordRepo.query.mockResolvedValue({
      items: [
        {
          ...record,
          pageId: null,
          position: 'a0',
          version: 1,
          createdById: user.id,
          createdAt: new Date('2026-06-11T00:00:00.000Z'),
          updatedAt: new Date('2026-06-11T00:00:00.000Z'),
          sort_0_null_rank: 0,
          sort_0_value: 'alpha',
        },
      ],
      meta: { hasNextPage: false },
    });
    recordRepo.findValuesByRecordIds.mockResolvedValue([]);

    const result = await service.query(
      {
        databaseId,
        sort: [{ propertyId: property.id, direction: 'asc' }],
      },
      user,
    );

    expect(result.items[0]).toEqual({
      id: record.id,
      databaseId,
      pageId: null,
      position: 'a0',
      version: 1,
      createdById: user.id,
      createdAt: new Date('2026-06-11T00:00:00.000Z'),
      updatedAt: new Date('2026-06-11T00:00:00.000Z'),
      values: {},
    });
    expect(result.items[0]).not.toHaveProperty('sort_0_null_rank');
    expect(result.items[0]).not.toHaveProperty('sort_0_value');
  });

  it('rejects multi select filters in phase one', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    propertyRepo.findActiveByDataSource.mockResolvedValue([
      multiSelectProperty,
    ]);

    await expect(
      service.query(
        {
          databaseId,
          filter: {
            propertyId: multiSelectProperty.id,
            operator: 'contains',
            value: 'option-1',
          },
        },
        user,
      ),
    ).rejects.toThrow('Unsupported filter property type');

    expect(recordRepo.query).not.toHaveBeenCalled();
  });

  it('combines view filters with request filters and lets request sort replace view sort', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    viewRepo.findActiveById.mockResolvedValue({
      id: 'view-1',
      dataSourceId: databaseId,
      configJson: {
        filter: {
          propertyId: property.id,
          operator: 'contains',
          value: 'docs',
        },
        sort: [{ propertyId: property.id, direction: 'desc' }],
        visiblePropertyIds: [property.id],
      },
    });
    propertyRepo.findActiveByDataSource.mockResolvedValue([
      property,
      numberProperty,
    ]);
    recordRepo.query.mockResolvedValue({
      items: [record],
      meta: { hasNextPage: false },
    });
    recordRepo.findValuesByRecordIds.mockResolvedValue([
      {
        id: 'value-1',
        recordId: record.id,
        propertyId: property.id,
        valueJson: 'x',
        version: 1,
        updatedAt: new Date('2026-06-11T00:00:00.000Z'),
      },
      {
        id: 'value-hidden',
        recordId: record.id,
        propertyId: numberProperty.id,
        valueJson: 7,
        version: 1,
        updatedAt: new Date('2026-06-11T00:00:00.000Z'),
      },
    ]);

    const result = await service.query(
      {
        databaseId,
        viewId: 'view-1',
        filter: {
          propertyId: numberProperty.id,
          operator: 'greater_than',
          value: 3,
        },
        sort: [{ propertyId: numberProperty.id, direction: 'asc' }],
      },
      user,
    );

    expect(recordRepo.query).toHaveBeenCalledWith({
      databaseId,
      cursor: undefined,
      limit: 50,
      filter: {
        and: [
          {
            propertyId: property.id,
            type: DataSourcePropertyType.Text,
            operator: 'contains',
            value: 'docs',
          },
          {
            propertyId: numberProperty.id,
            type: DataSourcePropertyType.Number,
            operator: 'greater_than',
            value: 3,
          },
        ],
      },
      sort: [
        {
          propertyId: numberProperty.id,
          type: DataSourcePropertyType.Number,
          direction: 'asc',
        },
      ],
    });
    expect(result.items[0].values).toEqual({
      [property.id]: expect.objectContaining({ value: 'x' }),
    });
  });

  it('enforces filter limits after merging view and request filters', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    viewRepo.findActiveById.mockResolvedValue({
      id: 'view-1',
      dataSourceId: databaseId,
      configJson: {
        filter: {
          and: Array.from({ length: 20 }, () => ({
            propertyId: property.id,
            operator: 'is_not_empty',
          })),
        },
      },
    });
    propertyRepo.findActiveByDataSource.mockResolvedValue([property]);

    await expect(
      service.query(
        {
          databaseId,
          viewId: 'view-1',
          filter: {
            propertyId: property.id,
            operator: 'is_not_empty',
          },
        },
        user,
      ),
    ).rejects.toThrow('Too many filter conditions');

    expect(recordRepo.query).not.toHaveBeenCalled();
  });

  it('supports sorted cursor pagination', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    propertyRepo.findActiveByDataSource.mockResolvedValue([property]);
    recordRepo.query.mockResolvedValue({
      items: [],
      meta: { hasNextPage: false },
    });
    recordRepo.findValuesByRecordIds.mockResolvedValue([]);

    await service.query(
      {
        databaseId,
        cursor: 'cursor-1',
        sort: [{ propertyId: property.id, direction: 'asc' }],
      },
      user,
    );

    expect(recordRepo.query).toHaveBeenCalledWith({
      databaseId,
      cursor: 'cursor-1',
      limit: 50,
      sort: [
        {
          propertyId: property.id,
          type: DataSourcePropertyType.Text,
          direction: 'asc',
        },
      ],
    });
  });

  it('normalizes select equals filters to helper column values', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    propertyRepo.findActiveByDataSource.mockResolvedValue([selectProperty]);
    recordRepo.query.mockResolvedValue({
      items: [],
      meta: { hasNextPage: false },
    });
    recordRepo.findValuesByRecordIds.mockResolvedValue([]);

    await service.query(
      {
        databaseId,
        filter: {
          propertyId: selectProperty.id,
          operator: 'equals',
          value: 'todo',
        },
      },
      user,
    );

    expect(recordRepo.query).toHaveBeenCalledWith({
      databaseId,
      cursor: undefined,
      limit: 50,
      filter: {
        propertyId: selectProperty.id,
        type: DataSourcePropertyType.Select,
        operator: 'equals',
        value: '001',
      },
    });
  });

  it('preserves date equals filter timezone data for calendar-date comparison', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    propertyRepo.findActiveByDataSource.mockResolvedValue([dateProperty]);
    recordRepo.query.mockResolvedValue({
      items: [],
      meta: { hasNextPage: false },
    });
    recordRepo.findValuesByRecordIds.mockResolvedValue([]);

    await service.query(
      {
        databaseId,
        filter: {
          propertyId: dateProperty.id,
          operator: 'equals',
          value: {
            start: '2026-06-11T15:30:00.000Z',
            timeZone: 'Asia/Seoul',
          },
        },
      },
      user,
    );

    expect(recordRepo.query).toHaveBeenCalledWith({
      databaseId,
      cursor: undefined,
      limit: 50,
      filter: {
        propertyId: dateProperty.id,
        type: DataSourcePropertyType.Date,
        operator: 'equals',
        value: {
          start: '2026-06-11T15:30:00.000Z',
          timeZone: 'Asia/Seoul',
        },
      },
    });
  });

  it('normalizes nested filters and enforces the leaf limit', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    propertyRepo.findActiveByDataSource.mockResolvedValue([
      property,
      numberProperty,
    ]);
    recordRepo.query.mockResolvedValue({
      items: [],
      meta: { hasNextPage: false },
    });
    recordRepo.findValuesByRecordIds.mockResolvedValue([]);

    await service.query(
      {
        databaseId,
        filter: {
          or: [
            { propertyId: property.id, operator: 'is_not_empty' },
            {
              and: [
                {
                  propertyId: numberProperty.id,
                  operator: 'less_than',
                  value: 10,
                },
              ],
            },
          ],
        },
      },
      user,
    );

    expect(recordRepo.query).toHaveBeenCalledWith({
      databaseId,
      cursor: undefined,
      limit: 50,
      filter: {
        or: [
          {
            propertyId: property.id,
            type: DataSourcePropertyType.Text,
            operator: 'is_not_empty',
          },
          {
            and: [
              {
                propertyId: numberProperty.id,
                type: DataSourcePropertyType.Number,
                operator: 'less_than',
                value: 10,
              },
            ],
          },
        ],
      },
    });

    await expect(
      service.query(
        {
          databaseId,
          filter: {
            and: Array.from({ length: 21 }, () => ({
              propertyId: property.id,
              operator: 'is_not_empty',
            })),
          },
        },
        user,
      ),
    ).rejects.toThrow('Too many filter conditions');
  });

  it('rejects unsupported operator and property type combinations', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    propertyRepo.findActiveByDataSource.mockResolvedValue([property]);

    await expect(
      service.query(
        {
          databaseId,
          filter: {
            propertyId: property.id,
            operator: 'greater_than',
            value: 1,
          },
        },
        user,
      ),
    ).rejects.toThrow('Unsupported filter operator');

    expect(recordRepo.query).not.toHaveBeenCalled();
  });

  it('normalizes sort arrays with at most three entries', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    propertyRepo.findActiveByDataSource.mockResolvedValue([
      property,
      selectProperty,
      numberProperty,
    ]);
    recordRepo.query.mockResolvedValue({
      items: [],
      meta: { hasNextPage: false },
    });
    recordRepo.findValuesByRecordIds.mockResolvedValue([]);

    await service.query(
      {
        databaseId,
        sort: [
          { propertyId: property.id, direction: 'asc' },
          { propertyId: selectProperty.id, direction: 'desc' },
          { propertyId: numberProperty.id, direction: 'asc' },
        ],
      },
      user,
    );

    expect(recordRepo.query).toHaveBeenCalledWith({
      databaseId,
      cursor: undefined,
      limit: 50,
      sort: [
        {
          propertyId: property.id,
          type: DataSourcePropertyType.Text,
          direction: 'asc',
        },
        {
          propertyId: selectProperty.id,
          type: DataSourcePropertyType.Select,
          direction: 'desc',
        },
        {
          propertyId: numberProperty.id,
          type: DataSourcePropertyType.Number,
          direction: 'asc',
        },
      ],
    });

    await expect(
      service.query(
        {
          databaseId,
          sort: [
            { propertyId: property.id },
            { propertyId: property.id },
            { propertyId: property.id },
            { propertyId: property.id },
          ],
        },
        user,
      ),
    ).rejects.toThrow('Too many sort conditions');
  });

  it('allows archived select options when normalizing equals filters', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    propertyRepo.findActiveByDataSource.mockResolvedValue([
      archivedSelectProperty,
    ]);
    recordRepo.query.mockResolvedValue({
      items: [],
      meta: { hasNextPage: false },
    });
    recordRepo.findValuesByRecordIds.mockResolvedValue([]);

    await service.query(
      {
        databaseId,
        filter: {
          propertyId: archivedSelectProperty.id,
          operator: 'equals',
          value: 'old',
        },
      },
      user,
    );

    expect(recordRepo.query).toHaveBeenCalledWith({
      databaseId,
      cursor: undefined,
      limit: 50,
      filter: {
        propertyId: archivedSelectProperty.id,
        type: DataSourcePropertyType.Select,
        operator: 'equals',
        value: '999',
      },
    });
  });

  it('rejects invalid client-supplied positions', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);

    await expect(
      service.create({ databaseId, position: 'invalid' }, user),
    ).rejects.toThrow(BadRequestException);

    expect(recordRepo.insert).not.toHaveBeenCalled();
  });

  it('validates person values against workspace users before saving', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    recordRepo.insert.mockResolvedValue(record);
    propertyRepo.findActiveByDataSource.mockResolvedValue([personProperty]);
    userRepo.findByIds.mockResolvedValueOnce([]);

    await expect(
      service.create(
        { databaseId, values: { [personProperty.id]: ['other-user'] } },
        user,
      ),
    ).rejects.toThrow('User not found');

    expect(userRepo.findByIds).toHaveBeenCalledWith(
      ['other-user'],
      user.workspaceId,
      expect.anything(),
    );
    expect(propertyValueRepo.upsert).not.toHaveBeenCalled();
  });

  it('preserves forbidden write failures instead of hiding them as not found', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    permissionService.validateWrite.mockRejectedValue(new ForbiddenException());

    await expect(service.create({ databaseId }, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('caps query limit at 100 through DTO validation', async () => {
    const dto = plainToInstance(QueryRecordsDto, {
      databaseId: '00000000-0000-4000-8000-000000000001',
      limit: 101,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('limit');
  });

  it('requires record values to be an object when present', async () => {
    const dto = plainToInstance(CreateRecordDto, {
      databaseId: '00000000-0000-4000-8000-000000000001',
      values: ['not', 'an', 'object'],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('values');
  });
});
