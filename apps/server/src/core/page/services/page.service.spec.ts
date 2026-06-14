jest.mock(
  'src/collaboration/collaboration.util',
  () => ({
    htmlToJson: jest.fn(),
    jsonToNode: jest.fn(),
    jsonToText: jest.fn(),
  }),
  { virtual: true },
);

jest.mock('../../../collaboration/collaboration.gateway', () => ({
  CollaborationGateway: jest.fn(),
}));

import { PageService } from './page.service';

describe('PageService', () => {
  const pageRepo = {
    getPageAndDescendants: jest.fn(),
    updatePage: jest.fn(),
    updatePages: jest.fn(),
  };
  const pagePermissionRepo = { filterAccessiblePageIds: jest.fn() };
  const attachmentRepo = { updateAttachmentsByPageId: jest.fn() };
  const dataSourceRepo = { updateSpaceForParentPages: jest.fn() };
  const trx = {
    deleteFrom: jest.fn(() => trxDeleteQuery),
    updateTable: jest.fn(() => trxUpdateQuery),
  };
  const trxDeleteQuery = {
    where: jest.fn(() => trxDeleteQuery),
    execute: jest.fn(),
  };
  const trxUpdateQuery = {
    set: jest.fn(() => trxUpdateQuery),
    where: jest.fn(() => trxUpdateQuery),
    execute: jest.fn(),
  };
  const db = {
    transaction: () => ({
      execute: (callback: any) => callback(trx),
    }),
  };
  const storageService = {};
  const attachmentQueue = {};
  const aiQueue = { add: jest.fn() };
  const generalQueue = {};
  const eventEmitter = {};
  const collaborationGateway = {};
  const watcherService = { movePageWatchersToSpace: jest.fn() };
  const transclusionService = {};

  let service: PageService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PageService(
      pageRepo as any,
      pagePermissionRepo as any,
      attachmentRepo as any,
      dataSourceRepo as any,
      db as any,
      storageService as any,
      attachmentQueue as any,
      aiQueue as any,
      generalQueue as any,
      eventEmitter as any,
      collaborationGateway as any,
      watcherService as any,
      transclusionService as any,
    );
    jest.spyOn(service, 'nextPagePosition').mockResolvedValue('a0');
  });

  it('syncs data source space when pages move to another space', async () => {
    const rootPage = {
      id: 'page-1',
      parentPageId: null,
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
    } as any;
    const childPage = {
      id: 'page-2',
      parentPageId: rootPage.id,
      spaceId: rootPage.spaceId,
      workspaceId: rootPage.workspaceId,
    } as any;
    const destinationSpace = { id: 'space-2' };
    pageRepo.getPageAndDescendants.mockResolvedValue([rootPage, childPage]);
    pagePermissionRepo.filterAccessiblePageIds.mockResolvedValue([
      rootPage.id,
      childPage.id,
    ]);

    await service.movePageToSpace(
      rootPage,
      destinationSpace.id,
      'user-1',
    );

    expect(dataSourceRepo.updateSpaceForParentPages).toHaveBeenCalledWith(
      expect.arrayContaining([rootPage.id]),
      destinationSpace.id,
      expect.anything(),
    );
  });
});
