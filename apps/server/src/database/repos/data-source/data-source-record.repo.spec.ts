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

  and(expressions: unknown[]) {
    this.ops.push(['and', expressions]);
    return { type: 'and', expressions };
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
      eb.and = expressionBuilder.and.bind(expressionBuilder);
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

  it('treats missing or null helper values as empty matches', async () => {
    await repo.query({
      databaseId: 'database-1',
      limit: 50,
      filter: {
        propertyId: 'property-1',
        type: 'text',
        operator: 'is_empty',
      },
    });

    const filterWhere = builder.ops.find(
      ([op, expression]) => op === 'whereCallback' && expression?.toOperationNode,
    );
    expect(filterWhere).toBeDefined();
    const filterSql = filterWhere[1].toOperationNode();
    expect(collectSqlFragments(filterSql)).toContain('not exists');
    expect(collectValueNodeValues(filterSql)).toContain('property-1');
  });

  it('builds recursive and/or filters with supported phase one operators', async () => {
    await repo.query({
      databaseId: 'database-1',
      limit: 50,
      filter: {
        or: [
          {
            propertyId: 'property-title',
            type: 'text',
            operator: 'contains',
            value: 'docs',
          },
          {
            and: [
              {
                propertyId: 'property-score',
                type: 'number',
                operator: 'greater_than',
                value: 10,
              },
              {
                propertyId: 'property-date',
                type: 'date',
                operator: 'before',
                value: new Date('2026-06-12T22:15:00.000Z'),
              },
            ],
          },
        ],
      },
    });

    const filterWhere = builder.ops.find(
      ([op]) => op === 'whereCallback',
    );
    expect(filterWhere).toBeDefined();
    expect(collectValueNodeValues(filterWhere[1])).toEqual(
      expect.arrayContaining(['property-title', '%docs%', 'property-score', 10, 'property-date']),
    );
  });

  it('sorts by up to three helper values before stable position and id tie breakers', async () => {
    await repo.query({
      databaseId: 'database-1',
      limit: 50,
      cursor: 'cursor-1',
      sort: [
        {
          propertyId: 'property-1',
          type: 'number',
          direction: 'asc',
        },
        {
          propertyId: 'property-2',
          type: 'text',
          direction: 'desc',
        },
        {
          propertyId: 'property-3',
          type: 'date',
          direction: 'asc',
        },
      ],
    });

    expect(builder.ops).toEqual(
      expect.arrayContaining([
        ['leftJoin', 'dataSourcePropertyValues as sortValue0', expect.any(Array)],
        ['leftJoin', 'dataSourcePropertyValues as sortValue1', expect.any(Array)],
        ['leftJoin', 'dataSourcePropertyValues as sortValue2', expect.any(Array)],
      ]),
    );

    expect(executeWithCursorPagination).toHaveBeenCalledWith(
      builder,
      expect.objectContaining({
        cursor: 'cursor-1',
        fields: [
          expect.objectContaining({ key: 'sort_0_null_rank' }),
          expect.objectContaining({ key: 'sort_0_value', direction: 'asc' }),
          expect.objectContaining({ key: 'sort_1_null_rank' }),
          expect.objectContaining({ key: 'sort_1_value', direction: 'desc' }),
          expect.objectContaining({ key: 'sort_2_null_rank' }),
          expect.objectContaining({ key: 'sort_2_value', direction: 'asc' }),
          expect.objectContaining({ key: 'position' }),
          expect.objectContaining({ key: 'id' }),
        ],
      }),
    );
  });

  it('compares date equals filters by value json calendar date and timezone', async () => {
    await repo.query({
      databaseId: 'database-1',
      limit: 50,
      filter: {
        propertyId: 'property-1',
        type: 'date',
        operator: 'equals',
        value: {
          start: '2026-06-11T15:30:00.000Z',
          timeZone: 'Asia/Seoul',
        },
      },
    });

    const dateWhere = builder.ops.find(
      ([op, expression]) => op === 'whereCallback' && expression?.toOperationNode,
    );
    expect(dateWhere).toBeDefined();
    const dateNode = dateWhere[1].toOperationNode();
    expect(collectSqlFragments(dateNode)).toContain("value_json->>'start'");
    expect(collectSqlFragments(dateNode)).toContain("value_json->>'timeZone'");
    expect(collectSqlFragments(dateNode)).not.toContain('cast($');
    expect(collectValueNodeValues(dateNode)).toContain('2026-06-12');
  });
});

function collectValueNodeValues(node: any): unknown[] {
  if (!node || typeof node !== 'object') return [];
  if (typeof node.toOperationNode === 'function') {
    return collectValueNodeValues(node.toOperationNode());
  }
  const own = node.kind === 'ValueNode' ? [node.value] : [];
  return [
    ...own,
    ...Object.values(node).flatMap((value) =>
      Array.isArray(value)
        ? value.flatMap(collectValueNodeValues)
        : collectValueNodeValues(value),
    ),
  ];
}

function collectSqlFragments(node: any): string {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.toOperationNode === 'function') {
    return collectSqlFragments(node.toOperationNode());
  }
  const own = Array.isArray(node.sqlFragments) ? node.sqlFragments.join('') : '';
  return (
    own +
    Object.values(node)
      .map((value) =>
        Array.isArray(value)
          ? value.map(collectSqlFragments).join('')
          : collectSqlFragments(value),
      )
      .join('')
  );
}
