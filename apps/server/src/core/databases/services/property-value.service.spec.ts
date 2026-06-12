import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSourcePropertyType } from './property-value-normalizer';
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
  const userRepo = { findById: jest.fn() };
  const db = { transaction: () => ({ execute: (cb: any) => cb('trx') }) };
  const service = new PropertyValueService(
    dataSourceRepo as any,
    recordRepo as any,
    propertyRepo as any,
    propertyValueRepo as any,
    permissionService as any,
    userRepo as any,
    db as any,
  );
  const user = { id: 'user-1', workspaceId: 'workspace-1' } as any;

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

  it('validates person values against workspace users before saving', async () => {
    recordRepo.findActiveById.mockResolvedValue({
      id: 'record-1',
      dataSourceId: 'database-1',
    });
    propertyRepo.findActiveById.mockResolvedValue({
      id: 'property-1',
      dataSourceId: 'database-1',
      type: DataSourcePropertyType.Person,
      configJson: {},
    });
    dataSourceRepo.findActiveById.mockResolvedValue({
      id: 'database-1',
      parentPageId: 'page-1',
    });
    userRepo.findById.mockResolvedValueOnce(null);

    await expect(
      service.update(
        {
          recordId: 'record-1',
          propertyId: 'property-1',
          value: ['other-user'],
        },
        user,
      ),
    ).rejects.toThrow('User not found');

    expect(userRepo.findById).toHaveBeenCalledWith(
      'other-user',
      user.workspaceId,
      expect.anything(),
    );
    expect(propertyValueRepo.upsert).not.toHaveBeenCalled();
  });

  it('preserves forbidden write failures instead of hiding them as not found', async () => {
    recordRepo.findActiveById.mockResolvedValue({
      id: 'record-1',
      dataSourceId: 'database-1',
    });
    propertyRepo.findActiveById.mockResolvedValue({
      id: 'property-1',
      dataSourceId: 'database-1',
      type: DataSourcePropertyType.Text,
      configJson: {},
    });
    dataSourceRepo.findActiveById.mockResolvedValue({
      id: 'database-1',
      parentPageId: 'page-1',
    });
    permissionService.validateWrite.mockRejectedValue(new ForbiddenException());

    await expect(
      service.update(
        { recordId: 'record-1', propertyId: 'property-1', value: 'x' },
        user,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
