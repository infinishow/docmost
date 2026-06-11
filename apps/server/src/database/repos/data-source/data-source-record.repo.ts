import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { dbOrTx } from '@docmost/db/utils';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import {
  DataSourcePropertyValue,
  DataSourceRecord,
  InsertableDataSourceRecord,
  UpdatableDataSourceRecord,
} from '@docmost/db/types/entity.types';

@Injectable()
export class DataSourceRecordRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  private readonly fields: Array<keyof DataSourceRecord> = [
    'id',
    'dataSourceId',
    'pageId',
    'position',
    'version',
    'createdById',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ];

  private readonly valueFields: Array<keyof DataSourcePropertyValue> = [
    'id',
    'dataSourceId',
    'recordId',
    'propertyId',
    'valueJson',
    'textValue',
    'numberValue',
    'dateValue',
    'boolValue',
    'version',
    'createdById',
    'lastEditedById',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ];

  async insert(
    data: InsertableDataSourceRecord,
    trx?: KyselyTransaction,
  ): Promise<DataSourceRecord> {
    return dbOrTx(this.db, trx)
      .insertInto('dataSourceRecords')
      .values(data)
      .returning(this.fields)
      .executeTakeFirstOrThrow();
  }

  async findActiveById(
    id: string,
    trx?: KyselyTransaction,
  ): Promise<DataSourceRecord | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('dataSourceRecords')
      .select(this.fields)
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async findLastPosition(
    dataSourceId: string,
    trx?: KyselyTransaction,
  ): Promise<string | undefined> {
    const result = await dbOrTx(this.db, trx)
      .selectFrom('dataSourceRecords')
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
    data: UpdatableDataSourceRecord,
    trx?: KyselyTransaction,
  ): Promise<DataSourceRecord | undefined> {
    return dbOrTx(this.db, trx)
      .updateTable('dataSourceRecords')
      .set({ ...data, updatedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .returning(this.fields)
      .executeTakeFirst();
  }

  async softDelete(id: string, trx?: KyselyTransaction): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('dataSourceRecords')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .execute();
  }

  async incrementVersion(
    id: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('dataSourceRecords')
      .set({
        version: sql<number>`data_source_records.version + 1`,
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .execute();
  }

  async findValuesByRecordIds(
    recordIds: string[],
    trx?: KyselyTransaction,
  ): Promise<DataSourcePropertyValue[]> {
    if (recordIds.length === 0) return [];

    return dbOrTx(this.db, trx)
      .selectFrom('dataSourcePropertyValues')
      .select(this.valueFields)
      .where('recordId', 'in', recordIds)
      .where('deletedAt', 'is', null)
      .execute();
  }

  async findActiveByDataSource(
    dataSourceId: string,
    pagination: PaginationOptions,
    trx?: KyselyTransaction,
  ) {
    const query = dbOrTx(this.db, trx)
      .selectFrom('dataSourceRecords')
      .select(this.fields)
      .where('dataSourceId', '=', dataSourceId)
      .where('deletedAt', 'is', null);

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      fields: [
        {
          expression: 'dataSourceRecords.position',
          direction: 'asc',
          key: 'position',
          orderModifier: (ob) => ob.collate('C').asc(),
          cursorExpression: sql`data_source_records.position collate "C"`,
        },
        { expression: 'dataSourceRecords.id', direction: 'asc', key: 'id' },
      ],
      parseCursor: (cursor) => cursor,
    });
  }
}
