import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import {
  CursorPaginationResult,
  executeWithCursorPagination,
} from '@docmost/db/pagination/cursor-pagination';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { dbOrTx } from '@docmost/db/utils';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import {
  DataSourcePropertyValue,
  DataSourceRecord,
  InsertableDataSourceRecord,
  UpdatableDataSourceRecord,
} from '@docmost/db/types/entity.types';

export type DataSourceRecordQueryFilter = {
  propertyId: string;
  type: string;
  operator: 'contains' | 'equals';
  value: unknown;
};

export type DataSourceRecordQuerySort = {
  propertyId: string;
  type: string;
  direction: 'asc' | 'desc';
};

export type DataSourceRecordQueryOptions = {
  databaseId: string;
  cursor?: string;
  limit: number;
  filter?: DataSourceRecordQueryFilter;
  sort?: DataSourceRecordQuerySort;
};

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

  async incrementVersion(id: string, trx?: KyselyTransaction): Promise<void> {
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

  async query(
    opts: DataSourceRecordQueryOptions,
    trx?: KyselyTransaction,
  ): Promise<CursorPaginationResult<DataSourceRecord>> {
    let query: any = dbOrTx(this.db, trx)
      .selectFrom('dataSourceRecords')
      .select(this.fields)
      .where('dataSourceRecords.dataSourceId', '=', opts.databaseId)
      .where('dataSourceRecords.deletedAt', 'is', null);

    if (opts.filter) {
      query = query
        .innerJoin(
          'dataSourcePropertyValues as filterValue',
          'filterValue.recordId',
          'dataSourceRecords.id',
        )
        .where('filterValue.propertyId', '=', opts.filter.propertyId)
        .where('filterValue.deletedAt', 'is', null);

      const column = propertyValueColumn(opts.filter.type);
      if (opts.filter.operator === 'contains') {
        query = query.where(
          'filterValue.textValue',
          'ilike',
          `%${String(opts.filter.value)}%`,
        );
      } else {
        query =
          opts.filter.value === null
            ? query.where(`filterValue.${column}`, 'is', null)
            : query.where(
                `filterValue.${column}`,
                '=',
                opts.filter.value as never,
              );
      }
    }

    if (opts.sort) {
      query = query
        .leftJoin('dataSourcePropertyValues as sortValue', (join) =>
          join
            .onRef('sortValue.recordId', '=', 'dataSourceRecords.id')
            .on('sortValue.propertyId', '=', opts.sort.propertyId)
            .on('sortValue.deletedAt', 'is', null),
        )
        .orderBy(
          `sortValue.${propertyValueColumn(opts.sort.type)}`,
          opts.sort.direction,
        );
    }

    return executeWithCursorPagination(query, {
      perPage: opts.limit,
      cursor: opts.cursor,
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
    } as any) as Promise<CursorPaginationResult<DataSourceRecord>>;
  }
}

function propertyValueColumn(type: string): string {
  if (type === 'number') return 'numberValue';
  if (type === 'checkbox') return 'boolValue';
  if (type === 'date') return 'dateValue';
  return 'textValue';
}
