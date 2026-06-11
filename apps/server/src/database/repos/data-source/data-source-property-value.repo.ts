import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { dbOrTx } from '@docmost/db/utils';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import {
  DataSourcePropertyValue,
  InsertableDataSourcePropertyValue,
} from '@docmost/db/types/entity.types';

@Injectable()
export class DataSourcePropertyValueRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  private readonly fields: Array<keyof DataSourcePropertyValue> = [
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

  async upsert(
    data: Omit<InsertableDataSourcePropertyValue, 'version'>,
    trx?: KyselyTransaction,
  ): Promise<DataSourcePropertyValue> {
    return dbOrTx(this.db, trx)
      .insertInto('dataSourcePropertyValues')
      .values({ ...data, version: 1 })
      .onConflict((oc) =>
        oc.columns(['recordId', 'propertyId']).doUpdateSet((eb) => ({
          valueJson: eb.ref('excluded.valueJson'),
          textValue: eb.ref('excluded.textValue'),
          numberValue: eb.ref('excluded.numberValue'),
          dateValue: eb.ref('excluded.dateValue'),
          boolValue: eb.ref('excluded.boolValue'),
          lastEditedById: eb.ref('excluded.lastEditedById'),
          updatedAt: new Date(),
          deletedAt: null,
          version: sql<number>`data_source_property_values.version + 1`,
        })),
      )
      .returning(this.fields)
      .executeTakeFirstOrThrow();
  }

  async softDeleteByPropertyId(
    propertyId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('dataSourcePropertyValues')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('propertyId', '=', propertyId)
      .where('deletedAt', 'is', null)
      .execute();
  }

  async softDeleteByRecordId(
    recordId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('dataSourcePropertyValues')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('recordId', '=', recordId)
      .where('deletedAt', 'is', null)
      .execute();
  }
}
