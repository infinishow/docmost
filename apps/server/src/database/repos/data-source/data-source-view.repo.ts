import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { dbOrTx } from '@docmost/db/utils';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import {
  DataSourceView,
  InsertableDataSourceView,
  UpdatableDataSourceView,
} from '@docmost/db/types/entity.types';

@Injectable()
export class DataSourceViewRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  private readonly fields: Array<keyof DataSourceView> = [
    'id',
    'dataSourceId',
    'name',
    'type',
    'configJson',
    'position',
    'createdById',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ];

  async insert(
    data: InsertableDataSourceView,
    trx?: KyselyTransaction,
  ): Promise<DataSourceView> {
    return dbOrTx(this.db, trx)
      .insertInto('dataSourceViews')
      .values(data)
      .returning(this.fields)
      .executeTakeFirstOrThrow();
  }

  async findActiveById(
    id: string,
    trx?: KyselyTransaction,
  ): Promise<DataSourceView | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('dataSourceViews')
      .select(this.fields)
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async findActiveByDataSource(
    dataSourceId: string,
    trx?: KyselyTransaction,
  ): Promise<DataSourceView[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('dataSourceViews')
      .select(this.fields)
      .where('dataSourceId', '=', dataSourceId)
      .where('deletedAt', 'is', null)
      .orderBy('position', sql`collate "C" asc`)
      .orderBy('id', 'asc')
      .execute();
  }

  async countActiveByDataSource(
    dataSourceId: string,
    trx?: KyselyTransaction,
  ): Promise<number> {
    const result = await dbOrTx(this.db, trx)
      .selectFrom('dataSourceViews')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('dataSourceId', '=', dataSourceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }

  async findLastPosition(
    dataSourceId: string,
    trx?: KyselyTransaction,
  ): Promise<string | undefined> {
    const result = await dbOrTx(this.db, trx)
      .selectFrom('dataSourceViews')
      .select('position')
      .where('dataSourceId', '=', dataSourceId)
      .where('deletedAt', 'is', null)
      .orderBy('position', sql`collate "C" desc`)
      .orderBy('id', 'desc')
      .executeTakeFirst();

    return result?.position;
  }

  async update(
    id: string,
    data: UpdatableDataSourceView,
    trx?: KyselyTransaction,
  ): Promise<DataSourceView | undefined> {
    return dbOrTx(this.db, trx)
      .updateTable('dataSourceViews')
      .set({ ...data, updatedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .returning(this.fields)
      .executeTakeFirst();
  }

  async softDelete(id: string, trx?: KyselyTransaction): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('dataSourceViews')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .execute();
  }
}
