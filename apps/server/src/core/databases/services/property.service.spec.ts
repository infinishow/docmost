import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePropertyDto, UpdatePropertyDto } from '../dto/property.dto';
import { PropertyService } from './property.service';

describe('PropertyService', () => {
  const dataSourceRepo = { findActiveById: jest.fn() };
  const propertyRepo = {
    findActiveById: jest.fn(),
    findLastPosition: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  };
  const viewRepo = {
    findActiveByDataSource: jest.fn(),
    update: jest.fn(),
  };
  const propertyValueRepo = { softDeleteByPropertyId: jest.fn() };
  const permissionService = { validateWrite: jest.fn() };
  const db = { transaction: () => ({ execute: (cb: any) => cb('trx') }) };
  const service = new PropertyService(
    dataSourceRepo as any,
    propertyRepo as any,
    viewRepo as any,
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

  it('rejects non-object property config payloads', async () => {
    const createDto = plainToInstance(CreatePropertyDto, {
      databaseId: '09a9b3ac-7b4e-4e4b-9287-718d76865727',
      name: 'Status',
      type: 'select',
      config: 'invalid',
    });
    const updateDto = plainToInstance(UpdatePropertyDto, {
      propertyId: '09a9b3ac-7b4e-4e4b-9287-718d76865727',
      config: 'invalid',
    });

    await expect(validate(createDto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'config' })]),
    );
    await expect(validate(updateDto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'config' })]),
    );
  });

  it('rejects invalid client-supplied positions', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);

    await expect(
      service.create(
        {
          databaseId: dataSource.id,
          name: 'Text',
          type: 'text',
          position: 'invalid',
        },
        user,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(propertyRepo.insert).not.toHaveBeenCalled();
  });

  it('rejects malformed select property config before saving', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);

    await expect(
      service.create(
        {
          databaseId: dataSource.id,
          name: 'Status',
          type: 'select',
          config: { options: [{ id: 'todo', name: 'Todo' }] },
        },
        user,
      ),
    ).rejects.toThrow('Invalid select option config');

    expect(propertyRepo.insert).not.toHaveBeenCalled();
  });

  it('rejects duplicate select option ids on update', async () => {
    propertyRepo.findActiveById.mockResolvedValue({
      ...property,
      type: 'select',
    });
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);

    await expect(
      service.update(
        {
          propertyId: property.id,
          config: {
            options: [
              { id: 'todo', name: 'Todo', sortKey: '001' },
              { id: 'todo', name: 'Duplicate', sortKey: '002' },
            ],
          },
        },
        user,
      ),
    ).rejects.toThrow('Duplicate select option id');

    expect(propertyRepo.update).not.toHaveBeenCalled();
  });

  it('returns mapped property responses', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    propertyRepo.insert.mockResolvedValue({
      id: property.id,
      dataSourceId: dataSource.id,
      name: 'Text',
      type: 'text',
      configJson: { width: 180 },
      position: 'a0',
      version: 1,
      createdAt: new Date('2026-06-11T00:00:00.000Z'),
      updatedAt: new Date('2026-06-11T00:00:00.000Z'),
      deletedAt: null,
    });

    const result = await service.create(
      {
        databaseId: dataSource.id,
        name: 'Text',
        type: 'text',
      },
      user,
    );

    expect(result).toEqual({
      id: property.id,
      databaseId: dataSource.id,
      name: 'Text',
      type: 'text',
      config: { width: 180 },
      position: 'a0',
      version: 1,
      createdAt: new Date('2026-06-11T00:00:00.000Z'),
      updatedAt: new Date('2026-06-11T00:00:00.000Z'),
    });
    expect(result).not.toHaveProperty('dataSourceId');
    expect(result).not.toHaveProperty('configJson');
  });

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
    viewRepo.findActiveByDataSource.mockResolvedValue([]);

    await service.delete(property.id, user);

    expect(propertyValueRepo.softDeleteByPropertyId).toHaveBeenCalledWith(
      property.id,
      expect.anything(),
    );
  });

  it('removes deleted property references from active view configs', async () => {
    propertyRepo.findActiveById.mockResolvedValue(property);
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    viewRepo.findActiveByDataSource.mockResolvedValue([
      {
        id: 'view-1',
        configJson: {
          visiblePropertyIds: [property.id, 'property-2'],
          propertyOrder: [property.id, 'property-2'],
          filter: {
            and: [
              { propertyId: property.id, operator: 'contains', value: 'x' },
              { propertyId: 'property-2', operator: 'contains', value: 'y' },
            ],
          },
          sort: [
            { propertyId: property.id, direction: 'asc' },
            { propertyId: 'property-2', direction: 'desc' },
          ],
        },
      },
    ]);

    await service.delete(property.id, user);

    expect(viewRepo.update).toHaveBeenCalledWith(
      'view-1',
      {
        configJson: {
          visiblePropertyIds: ['property-2'],
          propertyOrder: ['property-2'],
          filter: {
            propertyId: 'property-2',
            operator: 'contains',
            value: 'y',
          },
          sort: [{ propertyId: 'property-2', direction: 'desc' }],
        },
      },
      expect.anything(),
    );
  });

  it('preserves forbidden write failures instead of hiding them as not found', async () => {
    propertyRepo.findActiveById.mockResolvedValue(property);
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    viewRepo.findActiveByDataSource.mockResolvedValue([]);
    permissionService.validateWrite.mockRejectedValue(new ForbiddenException());

    await expect(service.delete(property.id, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
