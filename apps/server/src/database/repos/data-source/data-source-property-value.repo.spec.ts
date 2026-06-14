import { DataSourcePropertyValueRepo } from './data-source-property-value.repo';

class FakeConflictUpdateBuilder {
  readonly whereRef = jest.fn(() => this);
}

class FakeConflictBuilder {
  readonly updateBuilder = new FakeConflictUpdateBuilder();
  readonly columns = jest.fn(() => this);
  readonly doUpdateSet = jest.fn(() => this.updateBuilder);
}

class FakeInsertBuilder {
  readonly conflictBuilder = new FakeConflictBuilder();
  readonly values = jest.fn(() => this);
  readonly onConflict = jest.fn((callback) => {
    callback(this.conflictBuilder);
    return this;
  });
  readonly returning = jest.fn(() => this);
  readonly executeTakeFirstOrThrow = jest.fn();
  readonly execute = jest.fn();
}

describe('DataSourcePropertyValueRepo', () => {
  it('guards upsert conflict updates by data source id', async () => {
    const builder = new FakeInsertBuilder();
    const repo = new DataSourcePropertyValueRepo({
      insertInto: jest.fn(() => builder),
    } as any);

    await repo.upsert({
      dataSourceId: 'database-1',
      recordId: 'record-1',
      propertyId: 'property-1',
      valueJson: 'x',
      textValue: 'x',
      numberValue: null,
      dateValue: null,
      boolValue: null,
      createdById: 'user-1',
      lastEditedById: 'user-1',
    } as any);

    expect(builder.conflictBuilder.updateBuilder.whereRef).toHaveBeenCalledWith(
      'dataSourcePropertyValues.dataSourceId',
      '=',
      'excluded.dataSourceId',
    );
  });
});
