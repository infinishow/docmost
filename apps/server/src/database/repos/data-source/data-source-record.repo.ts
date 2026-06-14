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

export type DataSourceRecordQueryFilterOperator =
  | 'contains'
  | 'equals'
  | 'greater_than'
  | 'less_than'
  | 'before'
  | 'after'
  | 'is_empty'
  | 'is_not_empty';

export type DataSourceRecordQueryFilterLeaf = {
  propertyId: string;
  type: string;
  operator: DataSourceRecordQueryFilterOperator;
  value?: unknown;
};

export type DataSourceRecordQueryFilter =
  | DataSourceRecordQueryFilterLeaf
  | { and: DataSourceRecordQueryFilter[] }
  | { or: DataSourceRecordQueryFilter[] };

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
  sort?: DataSourceRecordQuerySort[];
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
        version: sql<number>`version + 1`,
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
      query = query.where((eb) => buildFilterExpression(eb, opts.filter!));
    }

    const paginationFields: any[] = [];
    if (opts.sort) {
      for (const [index, sort] of opts.sort.slice(0, 3).entries()) {
        const alias = `sortValue${index}`;
        const nullAlias = `sort_${index}_null_rank`;
        const valueAlias = `sort_${index}_value`;
        const column = propertyValueColumn(sort.type);
        const valueRef = sql.ref(`${alias}.${column}`);
        const nullRankExpression = sql<number>`case when ${valueRef} is null then 1 else 0 end`;
        const valueExpression = sortCursorValueExpression(valueRef, sort.type);
        query = query
          .leftJoin(`dataSourcePropertyValues as ${alias}`, (join) =>
            join
              .onRef(`${alias}.recordId`, '=', 'dataSourceRecords.id')
              .on(`${alias}.propertyId`, '=', sort.propertyId)
              .on(`${alias}.deletedAt`, 'is', null),
          )
          .select(nullRankExpression.as(nullAlias))
          .select(valueExpression.as(valueAlias));
        paginationFields.push(
          {
            expression: nullAlias,
            direction: 'asc',
            key: nullAlias,
            cursorExpression: nullRankExpression,
          },
          {
            expression: valueAlias,
            direction: sort.direction,
            key: valueAlias,
            cursorExpression: valueExpression,
          },
        );
      }
    }

    return executeWithCursorPagination(query, {
      perPage: opts.limit,
      cursor: opts.cursor,
      fields: [
        ...paginationFields,
        {
          expression: 'dataSourceRecords.position',
          direction: 'asc',
          key: 'position',
          orderModifier: (ob) => ob.collate('C').asc(),
          cursorExpression: sql`data_source_records.position collate "C"`,
        },
        { expression: 'dataSourceRecords.id', direction: 'asc', key: 'id' },
      ],
      parseCursor: (cursor) => parseQueryCursor(cursor, opts.sort ?? []),
    } as any) as Promise<CursorPaginationResult<DataSourceRecord>>;
  }
}

function buildFilterExpression(
  eb: any,
  filter: DataSourceRecordQueryFilter,
): any {
  if ('and' in filter) {
    return eb.and(
      filter.and.map((child) => buildFilterExpression(eb, child)),
    );
  }
  if ('or' in filter) {
    return eb.or(
      filter.or.map((child) => buildFilterExpression(eb, child)),
    );
  }
  return buildLeafFilterExpression(filter);
}

function buildLeafFilterExpression(filter: DataSourceRecordQueryFilterLeaf): any {
  const column = propertyValueColumn(filter.type);
  const valueRef = sql.ref(`filter_value.${column}`);
  const base = sql`filter_value.record_id = data_source_records.id
    and filter_value.property_id = ${filter.propertyId}
    and filter_value.deleted_at is null`;

  if (
    filter.operator === 'is_empty' ||
    (filter.operator === 'equals' && filter.value === null)
  ) {
    return sql`not exists (
      select 1 from data_source_property_values as filter_value
      where ${base}
      and ${valueRef} is not null
      and ${emptyComparableExpression(filter, valueRef)}
    )`;
  }

  if (filter.operator === 'is_not_empty') {
    return sql`exists (
      select 1 from data_source_property_values as filter_value
      where ${base}
      and ${valueRef} is not null
      and ${emptyComparableExpression(filter, valueRef)}
    )`;
  }

  return sql`exists (
    select 1 from data_source_property_values as filter_value
    where ${base}
    and ${operatorExpression(filter, valueRef)}
  )`;
}

function emptyComparableExpression(
  filter: DataSourceRecordQueryFilterLeaf,
  valueRef: any,
): any {
  return isTextLikeType(filter.type) ? sql`${valueRef} != ''` : sql`true`;
}

function operatorExpression(
  filter: DataSourceRecordQueryFilterLeaf,
  valueRef: any,
): any {
  if (filter.operator === 'contains') {
    return sql`${valueRef} ilike ${`%${String(filter.value)}%`}`;
  }
  if (filter.type === 'date' && filter.operator === 'equals') {
    return sql`${dateValueCalendarExpression()} = ${dateFilterCalendarDate(filter.value)}::date`;
  }
  if (filter.operator === 'greater_than' || filter.operator === 'after') {
    return sql`${valueRef} > ${filter.value as never}`;
  }
  if (filter.operator === 'less_than' || filter.operator === 'before') {
    return sql`${valueRef} < ${filter.value as never}`;
  }
  return sql`${valueRef} = ${filter.value as never}`;
}

function sortCursorValueExpression(ref: any, type: string): any {
  if (type === 'number') return sql<number>`coalesce(${ref}, 0)`;
  if (type === 'checkbox') return sql<number>`case when ${ref} then 1 else 0 end`;
  if (type === 'date') return sql<Date>`coalesce(${ref}, '1970-01-01'::timestamptz)`;
  return sql<string>`coalesce(${ref}, '')`;
}

function parseQueryCursor(
  cursor: Record<string, string>,
  sortItems: DataSourceRecordQuerySort[],
): Record<string, unknown> {
  const parsed: Record<string, unknown> = { ...cursor };

  for (const [index, sort] of sortItems.slice(0, 3).entries()) {
    parsed[`sort_${index}_null_rank`] = Number.parseInt(
      cursor[`sort_${index}_null_rank`],
      10,
    );

    const valueKey = `sort_${index}_value`;
    if (sort.type === 'number' || sort.type === 'checkbox') {
      parsed[valueKey] = Number(cursor[valueKey]);
    } else if (sort.type === 'date') {
      parsed[valueKey] = new Date(cursor[valueKey]);
    }
  }

  return parsed;
}

function dateValueCalendarExpression(): any {
  return sql`cast((filter_value.value_json->>'start')::timestamptz at time zone coalesce(nullif(filter_value.value_json->>'timeZone', ''), 'UTC') as date)`;
}

function dateFilterCalendarDate(value: unknown): string {
  if (isDateFilterValue(value)) {
    return toCalendarDate(value.start, value.timeZone);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return new Date(String(value)).toISOString().slice(0, 10);
}

function toCalendarDate(value: string, timeZone = 'UTC'): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const partByType = new Map(parts.map((part) => [part.type, part.value]));
  return [
    partByType.get('year'),
    partByType.get('month'),
    partByType.get('day'),
  ].join('-');
}

function isDateFilterValue(
  value: unknown,
): value is { start: string; timeZone?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as any).start === 'string' &&
    ((value as any).timeZone === undefined ||
      typeof (value as any).timeZone === 'string')
  );
}

function isTextLikeType(type: string): boolean {
  return ['title', 'text', 'url', 'email', 'phone', 'select'].includes(type);
}

function propertyValueColumn(type: string): string {
  if (type === 'number') return 'numberValue';
  if (type === 'checkbox') return 'boolValue';
  if (type === 'date') return 'dateValue';
  return 'textValue';
}
