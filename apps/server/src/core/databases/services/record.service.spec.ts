import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
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
  const propertyValueRepo = {
    upsert: jest.fn(),
    softDeleteByRecordId: jest.fn(),
  };
  const permissionService = {
    validateWrite: jest.fn(),
    validateRead: jest.fn(),
  };
  const db = { transaction: () => ({ execute: (cb: any) => cb('trx') }) };
  const service = new RecordService(
    dataSourceRepo as any,
    recordRepo as any,
    propertyRepo as any,
    propertyValueRepo as any,
    permissionService as any,
    db as any,
  );
  const user = { id: 'user-1' } as any;
  const databaseId = 'database-1';
  const dataSource = { id: databaseId, parentPageId: 'page-1' } as any;
  const record = { id: 'record-1', dataSourceId: databaseId } as any;
  const property = {
    id: 'property-1',
    dataSourceId: databaseId,
    type: 'text',
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

  it('upserts initial values when creating a record', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    recordRepo.insert.mockResolvedValue(record);
    propertyRepo.findActiveByDataSource.mockResolvedValue([property]);
    propertyValueRepo.upsert.mockResolvedValue({
      id: 'value-1',
      propertyId: property.id,
      valueJson: 'x',
      version: 1,
      updatedAt: new Date('2026-06-11T00:00:00.000Z'),
    });

    const result = await service.create(
      { databaseId, values: { [property.id]: 'x' } },
      user,
    );

    expect(propertyValueRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: record.id }),
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

  it('rejects view-backed queries in phase one instead of ignoring viewId', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);

    await expect(
      service.query({ databaseId, viewId: 'view-1' }, user),
    ).rejects.toThrow('View queries are not supported');

    expect(recordRepo.query).not.toHaveBeenCalled();
  });

  it('rejects sorted cursor pagination until sort keys are cursor-safe', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    propertyRepo.findActiveByDataSource.mockResolvedValue([property]);

    await expect(
      service.query(
        {
          databaseId,
          cursor: 'cursor-1',
          sort: { propertyId: property.id, direction: 'asc' },
        },
        user,
      ),
    ).rejects.toThrow('Sorted cursor pagination is not supported');

    expect(recordRepo.query).not.toHaveBeenCalled();
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

  it('caps query limit at 100 through DTO validation', async () => {
    const dto = plainToInstance(QueryRecordsDto, {
      databaseId: '00000000-0000-4000-8000-000000000001',
      limit: 101,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('limit');
  });
});
