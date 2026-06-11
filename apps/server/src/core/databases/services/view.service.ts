import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { DataSourceRepo } from '@docmost/db/repos/data-source/data-source.repo';
import { DataSourceViewRepo } from '@docmost/db/repos/data-source/data-source-view.repo';
import { DataSourceView, User } from '@docmost/db/types/entity.types';
import { CreateViewDto, UpdateViewDto } from '../dto/view.dto';
import { DatabasePermissionService } from './database-permission.service';

@Injectable()
export class ViewService {
  constructor(
    private readonly dataSourceRepo: DataSourceRepo,
    private readonly viewRepo: DataSourceViewRepo,
    private readonly permissionService: DatabasePermissionService,
  ) {}

  async create(dto: CreateViewDto, user: User): Promise<DataSourceView> {
    if (dto.type !== 'table') {
      throw new BadRequestException('Only table views are supported');
    }
    const dataSource = await this.findActiveDataSource(dto.databaseId);
    await this.permissionService.validateWrite(dataSource, user);
    const lastPosition = await this.viewRepo.findLastPosition(dataSource.id);
    return this.viewRepo.insert({
      dataSourceId: dataSource.id,
      name: dto.name,
      type: dto.type,
      configJson: (dto.config ?? {}) as any,
      position:
        dto.position ?? generateJitteredKeyBetween(lastPosition ?? null, null),
      createdById: user.id,
    });
  }

  async update(dto: UpdateViewDto, user: User): Promise<DataSourceView> {
    const view = await this.findActiveView(dto.viewId);
    const dataSource = await this.findActiveDataSource(view.dataSourceId);
    await this.permissionService.validateWrite(dataSource, user);
    const updated = await this.viewRepo.update(view.id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.config !== undefined ? { configJson: dto.config as any } : {}),
      ...(dto.position !== undefined ? { position: dto.position } : {}),
    });
    if (!updated) throw new NotFoundException('View not found');
    return updated;
  }

  async delete(viewId: string, user: User): Promise<void> {
    const view = await this.findActiveView(viewId);
    const dataSource = await this.findActiveDataSource(view.dataSourceId);
    await this.permissionService.validateWrite(dataSource, user);
    const count = await this.viewRepo.countActiveByDataSource(dataSource.id);
    if (count <= 1) {
      throw new BadRequestException('Cannot delete the last view');
    }
    await this.viewRepo.softDelete(view.id);
  }

  private async findActiveDataSource(databaseId: string) {
    const dataSource = await this.dataSourceRepo.findActiveById(databaseId);
    if (!dataSource) throw new NotFoundException('Database not found');
    return dataSource;
  }

  private async findActiveView(viewId: string) {
    const view = await this.viewRepo.findActiveById(viewId);
    if (!view) throw new NotFoundException('View not found');
    return view;
  }
}
