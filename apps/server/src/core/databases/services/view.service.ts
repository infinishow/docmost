import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { DataSourceRepo } from '@docmost/db/repos/data-source/data-source.repo';
import { DataSourceViewRepo } from '@docmost/db/repos/data-source/data-source-view.repo';
import { DataSourceView, User } from '@docmost/db/types/entity.types';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { CreateViewDto, UpdateViewDto } from '../dto/view.dto';
import { DatabasePermissionService } from './database-permission.service';

@Injectable()
export class ViewService {
  constructor(
    private readonly dataSourceRepo: DataSourceRepo,
    private readonly viewRepo: DataSourceViewRepo,
    private readonly permissionService: DatabasePermissionService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async create(dto: CreateViewDto, user: User): Promise<DataSourceView> {
    if (dto.type !== 'table') {
      throw new BadRequestException('Only table views are supported');
    }
    const dataSource = await this.findActiveDataSource(dto.databaseId);
    await this.validateWrite(dataSource, user);
    const lastPosition = await this.viewRepo.findLastPosition(dataSource.id);
    return this.viewRepo.insert({
      dataSourceId: dataSource.id,
      name: dto.name,
      type: dto.type,
      configJson: (dto.config ?? {}) as any,
      position:
        validatePosition(dto.position) ??
        generateJitteredKeyBetween(lastPosition ?? null, null),
      createdById: user.id,
    });
  }

  async update(dto: UpdateViewDto, user: User): Promise<DataSourceView> {
    const view = await this.findActiveView(dto.viewId);
    const dataSource = await this.findActiveDataSource(view.dataSourceId);
    await this.validateWrite(dataSource, user);
    const updated = await this.viewRepo.update(view.id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.config !== undefined ? { configJson: dto.config as any } : {}),
      ...(dto.position !== undefined
        ? { position: validatePosition(dto.position) }
        : {}),
    });
    if (!updated) throw new NotFoundException('View not found');
    return updated;
  }

  async delete(viewId: string, user: User): Promise<void> {
    const view = await this.findActiveView(viewId);
    const dataSource = await this.findActiveDataSource(view.dataSourceId);
    await this.validateWrite(dataSource, user);
    await executeTx(this.db, async (trx) => {
      await trx
        .selectFrom('dataSources')
        .select('id')
        .where('id', '=', dataSource.id)
        .forUpdate()
        .executeTakeFirst();

      const count = await this.viewRepo.countActiveByDataSource(
        dataSource.id,
        trx,
      );
      if (count <= 1) {
        throw new BadRequestException('Cannot delete the last view');
      }
      await this.viewRepo.softDelete(view.id, trx);
    });
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

  private async validateWrite(dataSource: any, user: User): Promise<void> {
    await this.permissionService.validateWrite(dataSource, user);
  }
}

function validatePosition(position: string | undefined): string | undefined {
  if (position === undefined) return undefined;
  try {
    generateJitteredKeyBetween(position, null);
    return position;
  } catch {
    throw new BadRequestException('Invalid position');
  }
}
