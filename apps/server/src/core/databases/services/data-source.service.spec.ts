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
    dataSourceRepo.insert.mockResolvedValue({
      id: 'database-1',
      parentPageId: 'page-1',
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      name: 'Tasks',
      description: null,
      createdById: user.id,
      createdAt: new Date('2026-06-11T00:00:00.000Z'),
      updatedAt: new Date('2026-06-11T00:00:00.000Z'),
      deletedAt: null,
    });
    propertyRepo.insert.mockResolvedValue({
      id: 'property-1',
      dataSourceId: 'database-1',
      name: 'Title',
      type: 'title',
      configJson: {},
      position: 'a0',
      version: 1,
      createdAt: new Date('2026-06-11T00:00:00.000Z'),
      updatedAt: new Date('2026-06-11T00:00:00.000Z'),
    });
    viewRepo.insert.mockResolvedValue({
      id: 'view-1',
      dataSourceId: 'database-1',
      name: 'Table',
      type: 'table',
      configJson: {},
      position: 'a0',
      createdAt: new Date('2026-06-11T00:00:00.000Z'),
      updatedAt: new Date('2026-06-11T00:00:00.000Z'),
    });

    const result = await service.create(
      { parentPageId: 'page-1', name: 'Tasks' },
      user,
      workspace,
    );

    expect(dataSourceRepo.insert).toHaveBeenCalled();
    expect(propertyRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'title' }),
      expect.anything(),
    );
    expect(viewRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'table' }),
      expect.anything(),
    );
    expect(result).toEqual({
      database: expect.objectContaining({
        id: 'database-1',
        parentPageId: 'page-1',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        name: 'Tasks',
      }),
      defaultView: expect.objectContaining({
        id: 'view-1',
        databaseId: 'database-1',
        config: {},
      }),
      properties: [
        expect.objectContaining({
          id: 'property-1',
          databaseId: 'database-1',
          config: {},
        }),
      ],
      capabilities: {
        canReadData: true,
        canWriteData: true,
        canWriteSchema: true,
        canWriteView: true,
      },
    });
    expect(result).not.toHaveProperty('dataSource');
    expect(result.properties[0]).not.toHaveProperty('dataSourceId');
    expect(result.properties[0]).not.toHaveProperty('configJson');
  });

  it('returns mapped info response with capabilities', async () => {
    dataSourceRepo.findActiveById.mockResolvedValue({
      id: 'database-1',
      parentPageId: 'page-1',
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      name: 'Tasks',
      description: null,
      createdById: user.id,
      createdAt: new Date('2026-06-11T00:00:00.000Z'),
      updatedAt: new Date('2026-06-11T00:00:00.000Z'),
      deletedAt: null,
    });
    propertyRepo.findActiveByDataSource.mockResolvedValue([
      {
        id: 'property-1',
        dataSourceId: 'database-1',
        name: 'Title',
        type: 'title',
        configJson: {},
        position: 'a0',
        version: 1,
        createdAt: new Date('2026-06-11T00:00:00.000Z'),
        updatedAt: new Date('2026-06-11T00:00:00.000Z'),
      },
    ]);
    viewRepo.findActiveByDataSource.mockResolvedValue([
      {
        id: 'view-1',
        dataSourceId: 'database-1',
        name: 'Table',
        type: 'table',
        configJson: {},
        position: 'a0',
        createdAt: new Date('2026-06-11T00:00:00.000Z'),
        updatedAt: new Date('2026-06-11T00:00:00.000Z'),
      },
    ]);

    const result = await service.info('database-1', user);

    expect(result).toEqual({
      database: expect.objectContaining({ id: 'database-1' }),
      properties: [expect.objectContaining({ databaseId: 'database-1' })],
      views: [expect.objectContaining({ databaseId: 'database-1' })],
      capabilities: {
        canReadData: true,
        canWriteData: true,
        canWriteSchema: true,
        canWriteView: true,
      },
    });
  });
});
