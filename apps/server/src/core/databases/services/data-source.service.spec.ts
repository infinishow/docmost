import { DataSourceService } from './data-source.service';

describe('DataSourceService', () => {
  const dataSourceRepo = { insert: jest.fn(), findActiveById: jest.fn() };
  const propertyRepo = {
    insert: jest.fn(),
    findActiveByDataSource: jest.fn(),
  };
  const viewRepo = { insert: jest.fn(), findActiveByDataSource: jest.fn() };
  const pageRepo = { findById: jest.fn() };
  const pageAccessService = { validateCanEdit: jest.fn() };
  const permissionService = {
    validateRead: jest.fn(),
    validateWrite: jest.fn(),
  };
  const db = { transaction: () => ({ execute: (cb: any) => cb('trx') }) };
  const service = new DataSourceService(
    dataSourceRepo as any,
    propertyRepo as any,
    viewRepo as any,
    pageRepo as any,
    pageAccessService as any,
    permissionService as any,
    db as any,
  );
  const user = { id: 'user-1' } as any;
  const workspace = { id: 'workspace-1' } as any;

  beforeEach(() => jest.clearAllMocks());

  it('creates a data source with title property and table view', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      deletedAt: null,
    });
    dataSourceRepo.insert.mockResolvedValue({ id: 'database-1' });
    propertyRepo.insert.mockResolvedValue({ id: 'property-1', type: 'title' });
    viewRepo.insert.mockResolvedValue({ id: 'view-1', type: 'table' });

    await service.create({ parentPageId: 'page-1', name: 'Tasks' }, user, workspace);

    expect(dataSourceRepo.insert).toHaveBeenCalled();
    expect(propertyRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'title' }),
      expect.anything(),
    );
    expect(viewRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'table' }),
      expect.anything(),
    );
  });
});
