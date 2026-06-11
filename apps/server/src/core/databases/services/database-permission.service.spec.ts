import { NotFoundException } from '@nestjs/common';
import { DatabasePermissionService } from './database-permission.service';

describe('DatabasePermissionService', () => {
  const pageRepo = { findById: jest.fn() };
  const pageAccessService = {
    validateCanView: jest.fn(),
    validateCanEdit: jest.fn(),
  };
  const service = new DatabasePermissionService(
    pageRepo as any,
    pageAccessService as any,
  );
  const user = { id: 'user-1' } as any;

  beforeEach(() => jest.clearAllMocks());

  it('rejects a missing parent page', async () => {
    pageRepo.findById.mockResolvedValue(undefined);

    await expect(
      service.validateRead({ parentPageId: 'page-1' } as any, user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects workspace drift', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      workspaceId: 'workspace-2',
      spaceId: 'space-1',
      deletedAt: null,
    });

    await expect(
      service.validateRead(
        {
          parentPageId: 'page-1',
          workspaceId: 'workspace-1',
          spaceId: 'space-1',
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('delegates read to PageAccessService.validateCanView', async () => {
    const page = {
      id: 'page-1',
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      deletedAt: null,
    };
    pageRepo.findById.mockResolvedValue(page);

    await service.validateRead(
      {
        parentPageId: 'page-1',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
      } as any,
      user,
    );

    expect(pageAccessService.validateCanView).toHaveBeenCalledWith(page, user);
  });
});
