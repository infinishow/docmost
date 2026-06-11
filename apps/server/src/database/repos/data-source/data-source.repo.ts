import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { dbOrTx } from '@docmost/db/utils';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import {
  DataSource,
  InsertableDataSource,
  UpdatableDataSource,
} from '@docmost/db/types/entity.types';

@Injectable()
export class DataSourceRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  private readonly fields: Array<keyof DataSource> = [
    'id',
    'workspaceId',
    'spaceId',
    'parentPageId',
    'name',
    'description',
    'createdById',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ];

  async insert(
    data: InsertableDataSource,
    trx?: KyselyTransaction,
  ): Promise<DataSource> {
    return dbOrTx(this.db, trx)
      .insertInto('dataSources')
      .values(data)
      .returning(this.fields)
      .executeTakeFirstOrThrow();
  }

  async findById(
    id: string,
    trx?: KyselyTransaction,
  ): Promise<DataSource | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('dataSources')
      .select(this.fields)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async findActiveById(
    id: string,
    trx?: KyselyTransaction,
  ): Promise<DataSource | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('dataSources')
      .select(this.fields)
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async update(
    id: string,
    data: UpdatableDataSource,
    trx?: KyselyTransaction,
  ): Promise<DataSource | undefined> {
    return dbOrTx(this.db, trx)
      .updateTable('dataSources')
      .set({ ...data, updatedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .returning(this.fields)
      .executeTakeFirst();
  }

  async softDelete(id: string, trx?: KyselyTransaction): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('dataSources')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .execute();
  }

  async updateSpaceForParentPages(
    pageIds: string[],
    spaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    if (pageIds.length === 0) return;

    await dbOrTx(this.db, trx)
      .updateTable('dataSources')
      .set({ spaceId, updatedAt: new Date() })
      .where('parentPageId', 'in', pageIds)
      .execute();
  }
}
