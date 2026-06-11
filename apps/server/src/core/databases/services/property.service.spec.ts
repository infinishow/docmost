import { PropertyService } from './property.service';

describe('PropertyService', () => {
  const dataSourceRepo = { findActiveById: jest.fn() };
  const propertyRepo = {
    findActiveById: jest.fn(),
    softDelete: jest.fn(),
  };
  const propertyValueRepo = { softDeleteByPropertyId: jest.fn() };
  const permissionService = { validateWrite: jest.fn() };
  const db = { transaction: () => ({ execute: (cb: any) => cb('trx') }) };
  const service = new PropertyService(
    dataSourceRepo as any,
    propertyRepo as any,
    propertyValueRepo as any,
    permissionService as any,
    db as any,
  );
  const user = { id: 'user-1' } as any;
  const dataSource = { id: 'database-1', parentPageId: 'page-1' } as any;
  const property = {
    id: 'property-1',
    dataSourceId: dataSource.id,
    type: 'text',
  } as any;
  const titleProperty = { ...property, id: 'title-1', type: 'title' };

  beforeEach(() => jest.clearAllMocks());

  it('rejects deleting title properties', async () => {
    propertyRepo.findActiveById.mockResolvedValue(titleProperty);
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);

    await expect(service.delete(titleProperty.id, user)).rejects.toThrow(
      'Title property cannot be deleted',
    );
  });

  it('soft deletes property values when deleting a property', async () => {
    propertyRepo.findActiveById.mockResolvedValue(property);
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);

    await service.delete(property.id, user);

    expect(propertyValueRepo.softDeleteByPropertyId).toHaveBeenCalledWith(
      property.id,
      expect.anything(),
    );
  });
});
