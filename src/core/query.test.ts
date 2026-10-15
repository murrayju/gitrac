import { describe, expect, test } from 'bun:test';
import { createDefaultConfig } from './config.ts';
import { EXIT_INVALID_INPUT, GitracError } from './errors.ts';
import {
  filterIssues,
  includesClosed,
  parseIssueQuery,
  queryIssues,
  sortIssues,
  splitValues,
} from './query.ts';
import type { Config, Issue } from './types.ts';

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: 1,
    title: 'An issue',
    status: 'todo',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2025-01-01T00:00:00Z',
    createdBy: 'tester',
    updated: '2025-01-01T00:00:00Z',
    description: '',
    comments: [],
    ...overrides,
  };
}

const config: Config = {
  ...createDefaultConfig(),
  assignees: [{ name: 'Justin Murray', email: 'justin@example.com' }],
};

const ISSUES: Issue[] = [
  issue({
    id: 1,
    title: 'Fix login timeout',
    priority: 'urgent',
    assignee: 'justin@example.com',
    labels: ['bug', 'auth'],
    description: 'Sessions expire too early.',
  }),
  issue({
    id: 2,
    title: 'Dark mode',
    status: 'backlog',
    priority: 'low',
    assignee: 'Alice',
    labels: ['feature'],
  }),
  issue({ id: 3, title: 'Docs', status: 'done', priority: 'high' }),
  issue({
    id: 4,
    title: 'Refactor',
    status: 'in_progress',
    priority: 'high',
    labels: ['chore'],
  }),
  issue({ id: 5, title: 'Dropped', status: 'cancelled', priority: 'none' }),
];

function ids(raw: Parameters<typeof parseIssueQuery>[0], mine?: boolean) {
  const query = parseIssueQuery(raw, config, {
    mine: mine ? { name: 'Justin Murray', email: '' } : undefined,
  });
  return queryIssues(ISSUES, query, config).map((i) => i.id);
}

function invalid(fn: () => unknown): GitracError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GitracError);
    expect((err as GitracError).exitCode).toBe(EXIT_INVALID_INPUT);
    return err as GitracError;
  }
  throw new Error('expected invalid_input');
}

describe('splitValues', () => {
  test('splits commas, flattens repeats, trims, drops empties', () => {
    expect(splitValues(undefined)).toEqual([]);
    expect(splitValues('urgent, high,')).toEqual(['urgent', 'high']);
    expect(splitValues(['bug', 'auth,ui'])).toEqual(['bug', 'auth', 'ui']);
    expect(splitValues('')).toEqual([]);
  });
});

describe('parseIssueQuery + queryIssues', () => {
  test('default: open issues only, sorted by id', () => {
    expect(ids({})).toEqual([1, 2, 4]);
  });

  test('comma-separated status, including closed ones', () => {
    expect(ids({ status: 'todo,done' })).toEqual([1, 3]);
    expect(ids({ status: ['backlog', 'cancelled'] })).toEqual([2, 5]);
  });

  test('status=all lists everything', () => {
    expect(ids({ status: 'all' })).toEqual([1, 2, 3, 4, 5]);
    expect(ids({ status: 'todo,all' })).toEqual([1, 2, 3, 4, 5]);
  });

  test('comma-separated priority', () => {
    expect(ids({ priority: 'urgent,high' })).toEqual([1, 4]);
    expect(ids({ priority: 'urgent,high', status: 'all' })).toEqual([1, 3, 4]);
  });

  test('comma-separated labels match any', () => {
    expect(ids({ label: 'auth,chore' })).toEqual([1, 4]);
    expect(ids({ label: 'nope' })).toEqual([]);
  });

  test('filters combine with AND', () => {
    expect(ids({ priority: 'urgent,high', label: 'chore' })).toEqual([4]);
  });

  test('assignee matches name or email, case-insensitively', () => {
    expect(ids({ assignee: 'justin@example.com' })).toEqual([1]);
    expect(ids({ assignee: 'JUSTIN@example.com' })).toEqual([1]);
    expect(ids({ assignee: 'justin murray' })).toEqual([1]);
    expect(ids({ assignee: 'alice' })).toEqual([2]);
    expect(ids({ assignee: 'alice,Justin Murray' })).toEqual([1, 2]);
    expect(ids({ assignee: 'nobody' })).toEqual([]);
  });

  test('mine matches the user by name or email', () => {
    expect(ids({}, true)).toEqual([1]);
    const byEmail = parseIssueQuery({}, config, {
      mine: { name: 'Someone Else', email: 'Justin@Example.com' },
    });
    expect(queryIssues(ISSUES, byEmail, config).map((i) => i.id)).toEqual([1]);
  });

  test('search requires every term in title or description', () => {
    expect(ids({ search: 'login' })).toEqual([1]);
    expect(ids({ search: 'LOGIN expire' })).toEqual([1]);
    expect(ids({ search: 'login dark' })).toEqual([]);
    expect(ids({ search: 'sessions' })).toEqual([1]);
    expect(ids({ search: '  ' })).toEqual([1, 2, 4]);
  });

  test('rejects unknown statuses, priorities and sort fields', () => {
    expect(invalid(() => ids({ status: 'todo,nope' })).message).toContain(
      'nope',
    );
    expect(invalid(() => ids({ priority: 'urgent,meh' })).message).toContain(
      'meh',
    );
    expect(invalid(() => ids({ sort: 'color' })).message).toContain('color');
  });
});

describe('includesClosed', () => {
  test('only when a closed status or all is requested', () => {
    expect(includesClosed({}, config)).toBe(false);
    expect(includesClosed({ status: ['todo'] }, config)).toBe(false);
    expect(includesClosed({ status: ['todo', 'done'] }, config)).toBe(true);
    expect(includesClosed({ status: 'all' }, config)).toBe(true);
  });
});

describe('sortIssues', () => {
  const all = filterIssues(ISSUES, { status: 'all' }, config);
  test('priority: most urgent first, ties by id', () => {
    expect(sortIssues(all, 'priority', config).map((i) => i.id)).toEqual([
      1, 3, 4, 2, 5,
    ]);
  });
  test('status: in_progress, todo, backlog, done, cancelled', () => {
    expect(sortIssues(all, 'status', config).map((i) => i.id)).toEqual([
      4, 1, 2, 3, 5,
    ]);
  });
  test('updated/created: newest first', () => {
    const a = issue({ id: 1, updated: '2025-01-01T00:00:00Z' });
    const b = issue({ id: 2, updated: '2025-02-01T00:00:00Z', created: 'x' });
    expect(sortIssues([a, b], 'updated', config).map((i) => i.id)).toEqual([
      2, 1,
    ]);
    expect(sortIssues([b, a], 'created', config).map((i) => i.id)).toEqual([
      1, 2,
    ]);
  });
});

describe('configured statuses and priorities (#57)', () => {
  const custom: Config = {
    ...config,
    statuses: [
      { name: 'new', closed: false },
      { name: 'doing', closed: false },
      { name: 'review', closed: false },
      { name: 'shipped', closed: true },
      { name: 'dropped', closed: true },
    ],
    priorities: [{ name: 'p0' }, { name: 'p1' }, { name: 'p2' }],
    defaultStatus: 'new',
    defaultPriority: 'p1',
  };
  const list = [
    issue({ id: 1, status: 'new', priority: 'p2' }),
    issue({ id: 2, status: 'shipped', priority: 'p0' }),
    issue({ id: 3, status: 'review', priority: 'p1' }),
    issue({ id: 4, status: 'doing', priority: 'p0' }),
    issue({ id: 5, status: 'dropped', priority: 'p2' }),
  ];
  const run = (raw: Parameters<typeof parseIssueQuery>[0]) =>
    queryIssues(list, parseIssueQuery(raw, custom), custom).map((i) => i.id);

  test('default listing hides the configured closed statuses', () => {
    expect(run({})).toEqual([1, 3, 4]);
    expect(includesClosed({ status: ['shipped'] }, custom)).toBe(true);
    expect(includesClosed({ status: ['review'] }, custom)).toBe(false);
  });

  test('sorts by the configured orders', () => {
    expect(run({ status: 'all', sort: 'status' })).toEqual([3, 4, 1, 2, 5]);
    expect(run({ status: 'all', sort: 'priority' })).toEqual([2, 4, 3, 1, 5]);
  });

  test('filters validate against (and match case-insensitively) the configured names', () => {
    expect(run({ status: 'REVIEW', priority: 'P1' })).toEqual([3]);
    expect(() => run({ status: 'todo' })).toThrow(
      'must be one of new, doing, review, shipped, dropped, all',
    );
    expect(() => run({ priority: 'urgent' })).toThrow(
      'must be one of p0, p1, p2',
    );
  });
});
