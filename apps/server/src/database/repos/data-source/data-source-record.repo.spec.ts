import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { DataSourceRecordRepo } from './data-source-record.repo';

jest.mock('@docmost/db/pagination/cursor-pagination', () => ({
  executeWithCursorPagination: jest.fn().mockResolvedValue({
    items: [],
    meta: { hasNextPage: false },
  }),
}));

class FakeJoinBuilder {
  readonly ops: any[] = [];

  onRef(left: string, op: string, right: string) {
    this.ops.push(['onRef', left, op, right]);
    return this;
  }

  on(left: string, op: string, right: unknown) {
    this.ops.push(['on', left, op, right]);
    return this;
  }
}

class FakeExpressionBuilder {
  readonly ops: any[] = [];

  call(left: string, op: string, right: unknown) {
    this.ops.push(['eb', left, op, right]);
    return { type: 'eb', left, op, right };
  }

  or(expressions: unknown[]) {
    this.ops.push(['or', expressions]);
    return { type: 'or', expressions };
  }
}

class FakeSelectBuilder {
  readonly ops: any[] = [];

  select(fields: unknown) {
    this.ops.push(['select', fields]);
    return this;
  }

  where(...args: any[]) {
    if (typeof args[0] === 'function') {
      const expressionBuilder = new FakeExpressionBuilder();
      const eb = expressionBuilder.call.bind(expressionBuilder) as any;
      eb.or = expressionBuilder.or.bind(expressionBuilder);
      this.ops.push(['whereCallback', args[0](eb), expressionBuilder.ops]);
      return this;
    }
    this.ops.push(['where', ...args]);
    return this;
  }

  innerJoin(...args: any[]) {
    this.ops.push(['innerJoin', ...args]);
    return this;
  }

  leftJoin(table: string, callback: (join: FakeJoinBuilder) => unknown) {
    const join = new FakeJoinBuilder();
    callback(join);
    this.ops.push(['leftJoin', table, join.ops]);
    return this;
  }

  orderBy(...args: any[]) {
    this.ops.push(['orderBy', ...args]);
    return this;
  }
}

describe('DataSourceRecordRepo.query', () => {
  let builder: FakeSelectBuilder;
  let repo: DataSourceRecordRepo;

  beforeEach(() => {
    jest.clearAllMocks();
    builder = new FakeSelectBuilder();
    repo = new DataSourceRecordRepo({
      selectFrom: jest.fn(() => builder),
    } as any);
  });

  it('treats missing property value rows as null equals matches', async () => {
    await repo.query({
      databaseId: 'database-1',
      limit: 50,
      filter: {
        propertyId: 'property-1',
        type: 'text',
        operator: 'equals',
        value: null,
      },
    });

    expect(builder.ops).toContainEqual([
      'leftJoin',
      'dataSourcePropertyValues as filterValue',
      [
        ['onRef', 'filterValue.recordId', '=', 'dataSourceRecords.id'],
        ['on', 'filterValue.propertyId', '=', 'property-1'],
        ['on', 'filterValue.deletedAt', 'is', null],
      ],
    ]);
    expect(builder.ops).not.toContainEqual([
      'innerJoin',
      'dataSourcePropertyValues as filterValue',
      'filterValue.recordId',
      'dataSourceRecords.id',
    ]);
    expect(builder.ops).toEqual(
      expect.arrayContaining([
        [
          'whereCallback',
          expect.objectContaining({ type: 'or' }),
          expect.arrayContaining([
            ['eb', 'filterValue.id', 'is', null],
            ['eb', 'filterValue.textValue', 'is', null],
          ]),
        ],
      ]),
    );
  });

  it('sorts null property helper values last in both directions', async () => {
    await repo.query({
      databaseId: 'database-1',
      limit: 50,
      sort: {
        propertyId: 'property-1',
        type: 'number',
        direction: 'asc',
      },
    });

    const orderOps = builder.ops.filter(([op]) => op === 'orderBy');
    expect(orderOps).toHaveLength(1);
    const orderNode = orderOps[0][1].toOperationNode();
    expect(orderNode.sqlFragments).toContain(' nulls last');
    expect(orderNode.parameters[1].sqlFragments).toContain('asc');
    expect(executeWithCursorPagination).toHaveBeenCalledWith(
      builder,
      expect.objectContaining({
        fields: expect.arrayContaining([
          expect.objectContaining({ key: 'position' }),
          expect.objectContaining({ key: 'id' }),
        ]),
      }),
    );
  });
});
