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
  const service = new ViewService(
    dataSourceRepo as any,
    viewRepo as any,
    permissionService as any,
  );
  const user = { id: 'user-1' } as any;
  const dataSource = { id: 'database-1', parentPageId: 'page-1' } as any;
  const lastView = { id: 'view-1', dataSourceId: dataSource.id } as any;

  beforeEach(() => jest.clearAllMocks());

  it('rejects non-table views', async () => {
    await expect(
      service.create({ databaseId: dataSource.id, name: 'Board', type: 'board' } as any, user),
    ).rejects.toThrow('Only table views are supported');
  });

  it('rejects deleting the last view', async () => {
    viewRepo.findActiveById.mockResolvedValue(lastView);
    dataSourceRepo.findActiveById.mockResolvedValue(dataSource);
    viewRepo.countActiveByDataSource.mockResolvedValue(1);

    await expect(service.delete(lastView.id, user)).rejects.toThrow(
      'Cannot delete the last view',
    );
  });
});
