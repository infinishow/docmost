import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('data_sources')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('parent_page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull(),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('created_by_id', 'uuid', (col) =>
      col.references('users.id').notNull(),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .createTable('data_source_properties')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('data_source_id', 'uuid', (col) =>
      col.references('data_sources.id').onDelete('cascade').notNull(),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('type', 'varchar', (col) => col.notNull())
    .addColumn('config_json', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('position', 'varchar', (col) => col.notNull())
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_by_id', 'uuid', (col) =>
      col.references('users.id').notNull(),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .addUniqueConstraint('data_source_properties_id_data_source_id_unique', [
      'id',
      'data_source_id',
    ])
    .execute();

  await db.schema
    .createTable('data_source_records')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('data_source_id', 'uuid', (col) =>
      col.references('data_sources.id').onDelete('cascade').notNull(),
    )
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('set null'),
    )
    .addColumn('position', 'varchar', (col) => col.notNull())
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_by_id', 'uuid', (col) =>
      col.references('users.id').notNull(),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .addUniqueConstraint('data_source_records_id_data_source_id_unique', [
      'id',
      'data_source_id',
    ])
    .execute();

  await db.schema
    .createTable('data_source_property_values')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('data_source_id', 'uuid', (col) =>
      col.references('data_sources.id').onDelete('cascade').notNull(),
    )
    .addColumn('record_id', 'uuid', (col) =>
      col.references('data_source_records.id').onDelete('cascade').notNull(),
    )
    .addColumn('property_id', 'uuid', (col) =>
      col.references('data_source_properties.id').onDelete('cascade').notNull(),
    )
    .addColumn('value_json', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'null'::jsonb`),
    )
    .addColumn('text_value', 'text')
    .addColumn('number_value', 'double precision')
    .addColumn('date_value', 'timestamptz')
    .addColumn('bool_value', 'boolean')
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_by_id', 'uuid', (col) =>
      col.references('users.id').notNull(),
    )
    .addColumn('last_edited_by_id', 'uuid', (col) =>
      col.references('users.id').notNull(),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .addUniqueConstraint(
      'data_source_property_values_record_id_property_id_unique',
      ['record_id', 'property_id'],
    )
    .execute();

  await db.schema
    .alterTable('data_source_property_values')
    .addForeignKeyConstraint(
      'data_source_property_values_record_data_source_fk',
      ['record_id', 'data_source_id'],
      'data_source_records',
      ['id', 'data_source_id'],
    )
    .execute();

  await db.schema
    .alterTable('data_source_property_values')
    .addForeignKeyConstraint(
      'data_source_property_values_property_data_source_fk',
      ['property_id', 'data_source_id'],
      'data_source_properties',
      ['id', 'data_source_id'],
    )
    .execute();

  await db.schema
    .createTable('data_source_views')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('data_source_id', 'uuid', (col) =>
      col.references('data_sources.id').onDelete('cascade').notNull(),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('type', 'varchar', (col) => col.notNull())
    .addColumn('config_json', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('position', 'varchar', (col) => col.notNull())
    .addColumn('created_by_id', 'uuid', (col) =>
      col.references('users.id').notNull(),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('data_sources_parent_page_id_idx')
    .on('data_sources')
    .column('parent_page_id')
    .execute();

  await db.schema
    .createIndex('data_sources_workspace_id_space_id_idx')
    .on('data_sources')
    .columns(['workspace_id', 'space_id'])
    .execute();

  await db.schema
    .createIndex('data_sources_deleted_at_idx')
    .on('data_sources')
    .column('deleted_at')
    .execute();

  await db.schema
    .createIndex('data_source_properties_data_source_id_position_idx')
    .on('data_source_properties')
    .columns(['data_source_id', 'position'])
    .execute();

  await db.schema
    .createIndex('data_source_properties_data_source_id_deleted_at_idx')
    .on('data_source_properties')
    .columns(['data_source_id', 'deleted_at'])
    .execute();

  await db.schema
    .createIndex('data_source_properties_one_active_title_idx')
    .on('data_source_properties')
    .column('data_source_id')
    .unique()
    .where(sql.ref('type'), '=', 'title')
    .where(sql.ref('deleted_at'), 'is', null)
    .execute();

  await db.schema
    .createIndex('data_source_records_data_source_id_position_idx')
    .on('data_source_records')
    .columns(['data_source_id', 'position'])
    .execute();

  await db.schema
    .createIndex('data_source_records_data_source_id_deleted_at_idx')
    .on('data_source_records')
    .columns(['data_source_id', 'deleted_at'])
    .execute();

  await db.schema
    .createIndex('data_source_property_values_record_id_idx')
    .on('data_source_property_values')
    .column('record_id')
    .execute();

  await db.schema
    .createIndex('data_source_property_values_data_source_id_idx')
    .on('data_source_property_values')
    .column('data_source_id')
    .execute();

  await db.schema
    .createIndex('data_source_property_values_property_id_idx')
    .on('data_source_property_values')
    .column('property_id')
    .execute();

  await db.schema
    .createIndex('data_source_property_values_property_id_text_value_idx')
    .on('data_source_property_values')
    .columns(['property_id', 'text_value'])
    .execute();

  await db.schema
    .createIndex('data_source_property_values_property_id_number_value_idx')
    .on('data_source_property_values')
    .columns(['property_id', 'number_value'])
    .execute();

  await db.schema
    .createIndex('data_source_property_values_property_id_date_value_idx')
    .on('data_source_property_values')
    .columns(['property_id', 'date_value'])
    .execute();

  await db.schema
    .createIndex('data_source_property_values_property_id_bool_value_idx')
    .on('data_source_property_values')
    .columns(['property_id', 'bool_value'])
    .execute();

  await db.schema
    .createIndex('data_source_views_data_source_id_position_idx')
    .on('data_source_views')
    .columns(['data_source_id', 'position'])
    .execute();

  await db.schema
    .createIndex('data_source_views_data_source_id_deleted_at_idx')
    .on('data_source_views')
    .columns(['data_source_id', 'deleted_at'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('data_source_views').execute();
  await db.schema.dropTable('data_source_property_values').execute();
  await db.schema.dropTable('data_source_records').execute();
  await db.schema.dropTable('data_source_properties').execute();
  await db.schema.dropTable('data_sources').execute();
}
