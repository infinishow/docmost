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
    recordRepo.findActiveByDataSource.mockResolvedValue({
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
});
