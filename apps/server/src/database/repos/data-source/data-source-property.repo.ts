import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { dbOrTx } from '@docmost/db/utils';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import {
  DataSourceProperty,
  InsertableDataSourceProperty,
  UpdatableDataSourceProperty,
} from '@docmost/db/types/entity.types';

@Injectable()
export class DataSourcePropertyRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  private readonly fields: Array<keyof DataSourceProperty> = [
    'id',
    'dataSourceId',
    'name',
    'type',
    'configJson',
    'position',
    'version',
    'createdById',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ];

  async insert(
    data: InsertableDataSourceProperty,
    trx?: KyselyTransaction,
  ): Promise<DataSourceProperty> {
    return dbOrTx(this.db, trx)
      .insertInto('dataSourceProperties')
      .values(data)
      .returning(this.fields)
      .executeTakeFirstOrThrow();
  }

  async findById(
    id: string,
    trx?: KyselyTransaction,
  ): Promise<DataSourceProperty | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('dataSourceProperties')
      .select(this.fields)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async findActiveById(
    id: string,
    trx?: KyselyTransaction,
  ): Promise<DataSourceProperty | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('dataSourceProperties')
      .select(this.fields)
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async findActiveByDataSource(
    dataSourceId: string,
    trx?: KyselyTransaction,
  ): Promise<DataSourceProperty[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('dataSourceProperties')
      .select(this.fields)
      .where('dataSourceId', '=', dataSourceId)
      .where('deletedAt', 'is', null)
      .orderBy('position', sql`collate "C" asc`)
      .orderBy('id', 'asc')
      .execute();
  }

  async findLastPosition(
    dataSourceId: string,
    trx?: KyselyTransaction,
  ): Promise<string | undefined> {
    const result = await dbOrTx(this.db, trx)
      .selectFrom('dataSourceProperties')
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
    data: UpdatableDataSourceProperty,
    trx?: KyselyTransaction,
  ): Promise<DataSourceProperty | undefined> {
    return dbOrTx(this.db, trx)
      .updateTable('dataSourceProperties')
      .set({ ...data, updatedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .returning(this.fields)
      .executeTakeFirst();
  }

  async softDelete(id: string, trx?: KyselyTransaction): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('dataSourceProperties')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .execute();
  }

  async countActiveTitleProperties(
    dataSourceId: string,
    trx?: KyselyTransaction,
  ): Promise<number> {
    const result = await dbOrTx(this.db, trx)
      .selectFrom('dataSourceProperties')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('dataSourceId', '=', dataSourceId)
      .where('type', '=', 'title')
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }
}
