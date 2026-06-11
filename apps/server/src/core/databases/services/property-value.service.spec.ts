import { NotFoundException } from '@nestjs/common';
import { PropertyValueService } from './property-value.service';

describe('PropertyValueService', () => {
  const dataSourceRepo = { findActiveById: jest.fn() };
  const recordRepo = {
    findActiveById: jest.fn(),
    incrementVersion: jest.fn(),
  };
  const propertyRepo = { findActiveById: jest.fn() };
  const propertyValueRepo = { upsert: jest.fn() };
  const permissionService = { validateWrite: jest.fn() };
  const db = { transaction: () => ({ execute: (cb: any) => cb('trx') }) };
  const service = new PropertyValueService(
    dataSourceRepo as any,
    recordRepo as any,
    propertyRepo as any,
    propertyValueRepo as any,
    permissionService as any,
    db as any,
  );
  const user = { id: 'user-1' } as any;

  beforeEach(() => jest.clearAllMocks());

  it('does not reveal foreign properties for a record', async () => {
    recordRepo.findActiveById.mockResolvedValue({
      id: 'record-1',
      dataSourceId: 'database-1',
    });
    propertyRepo.findActiveById.mockResolvedValue({
      id: 'property-1',
      dataSourceId: 'database-2',
    });

    await expect(
      service.update(
        { recordId: 'record-1', propertyId: 'property-1', value: 'x' },
        user,
      ),
    ).rejects.toThrow('Value not found');
  });
});
