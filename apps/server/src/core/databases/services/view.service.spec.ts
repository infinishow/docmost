import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateViewDto, UpdateViewDto } from '../dto/view.dto';
import { ViewService } from './view.service';

describe('ViewService', () => {
  const dataSourceRepo = { findActiveById: jest.fn() };
  const viewRepo = {
    findActiveById: jest.fn(),
    findLastPosition: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    countActiveByDataSource: jest.fn(),
    softDelete: jest.fn(),
  };
  const permissionService = { validateWrite: jest.fn() };
  const trx = {
    selectFrom: jest.fn(),
  };
  const lockQuery = {
    select: jest.fn(),
    where: jest.fn(),
    forUpdate: jest.fn(),
    executeTakeFirst: jest.fn(),
  };
  const db = { transaction: () => ({ execute: (cb: any) => cb(trx) }) };
  const service = new ViewService(
    dataSourceRepo as any,
    viewRepo as any,
    permissionService as any,
    db as any,
  );
  const user = { id: 'user-1' } as any;
  const dataSource = { id: 'database-1', parentPageId: 'page-1' } as any;
  const lastView = { id: 'view-1', dataSourceId: dataSource.id } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    trx.selectFrom.mockReturnValue(lockQuery);
    lockQuery.select.mockReturnValue(lockQuery);
    lockQuery.where.mockReturnValue(lockQuery);
    lockQuery.forUpdate.mockReturnValue(lockQuery);
    lockQuery.executeTakeFirst.mockResolvedValue({ id: dataSource.id });
  });

  it('rejects non-object view config payloads', async () => {
    const createDto = plainToInstance(CreateViewDto, {
      databaseId: '09a9b3ac-7b4e-4e4b-9287-718d76865727',
      name: 'Table',
      type: 'table',
      config: 'invalid',
    });
    const updateDto = plainToInstance(UpdateViewDto, {
      viewId: '09a9b3ac-7b4e-4e4b-9287-718d76865727',
      config: 'invalid',
    });

    await expect(validate(createDto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'config' }),
      ]),
    );
    await expect(validate(updateDto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'config' }),
      ]),
    );
  });

  it('rejects non-table views', async () => {
    await expect(
      service.create({ databaseId: dataSource.id, name: 'Board', type: 'board' } as any, user),
    ).rejects.toThrow('Only table views are supported');
  });

  it('rejects invalid client-supplied positions', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);

    await expect(
      service.create(
        {
          databaseId: dataSource.id,
          name: 'Table',
          type: 'table',
          position: 'invalid',
        },
        user,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(viewRepo.insert).not.toHaveBeenCalled();
  });

  it('uses a structured default table view config', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);

    await service.create(
      {
        databaseId: dataSource.id,
        name: 'Table',
        type: 'table',
      },
      user,
    );

    expect(viewRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        configJson: {
          visiblePropertyIds: [],
          propertyOrder: [],
          filter: null,
          sort: [],
        },
      }),
    );
  });

  it('rejects deleting the last view', async () => {
    viewRepo.findActiveById.mockResolvedValue(lastView);
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    viewRepo.countActiveByDataSource.mockResolvedValue(1);

    await expect(service.delete(lastView.id, user)).rejects.toThrow(
      'Cannot delete the last view',
    );
  });

  it('deletes views inside a transaction after last-view guard', async () => {
    viewRepo.findActiveById.mockResolvedValue(lastView);
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    viewRepo.countActiveByDataSource.mockResolvedValue(2);

    await service.delete(lastView.id, user);

    expect(viewRepo.countActiveByDataSource).toHaveBeenCalledWith(
      dataSource.id,
      expect.anything(),
    );
    expect(viewRepo.softDelete).toHaveBeenCalledWith(
      lastView.id,
      expect.anything(),
    );
  });

  it('locks the parent data source before counting active views', async () => {
    viewRepo.findActiveById.mockResolvedValue(lastView);
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    viewRepo.countActiveByDataSource.mockResolvedValue(2);

    await service.delete(lastView.id, user);

    expect(trx.selectFrom).toHaveBeenCalledWith('dataSources');
    expect(lockQuery.select).toHaveBeenCalledWith('id');
    expect(lockQuery.where).toHaveBeenCalledWith('id', '=', dataSource.id);
    expect(lockQuery.forUpdate).toHaveBeenCalled();
    expect(lockQuery.executeTakeFirst).toHaveBeenCalled();
    expect(lockQuery.executeTakeFirst.mock.invocationCallOrder[0]).toBeLessThan(
      viewRepo.countActiveByDataSource.mock.invocationCallOrder[0],
    );
  });

  it('preserves forbidden write failures instead of hiding them as not found', async () => {
    viewRepo.findActiveById.mockResolvedValue(lastView);
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    permissionService.validateWrite.mockRejectedValue(new ForbiddenException());

    await expect(service.delete(lastView.id, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
