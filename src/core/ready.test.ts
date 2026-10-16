import { describe, expect, test } from 'bun:test';
import type { ClaimUser } from './claim.ts';
import { createDefaultConfig } from './config.ts';
import { indexIssues } from './dependencies.ts';
import type { IssueStateElsewhere } from './elsewhere.ts';
import { parseIssueQuery } from './query.ts';
import { isAvailableTo, nextIssue, readyIssues } from './ready.ts';
import type { Issue } from './types.ts';

/** Regression tests for #55: `gitrac ready` / `next`. */

const ME: ClaimUser = { name: 'Ada', email: 'ada@example.com' };

function issue(id: number, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    title: `Issue ${id}`,
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

const config = createDefaultConfig();

function ready(issues: Issue[], raw: Record<string, string> = {}): number[] {
  const query = parseIssueQuery({ sort: 'priority', ...raw }, config, {
    mine: raw.mine ? ME : undefined,
  });
  return readyIssues(issues, indexIssues(issues), ME, query, config).map(
    (i) => i.id,
  );
}

describe('isAvailableTo', () => {
  test('open and unassigned or mine', () => {
    expect(isAvailableTo(issue(1), ME, config)).toBe(true);
    expect(
      isAvailableTo(issue(1, { assignee: 'ADA@example.com' }), ME, config),
    ).toBe(true);
    expect(
      isAvailableTo(
        issue(1, { status: 'in_progress', assignee: 'Ada' }),
        ME,
        config,
      ),
    ).toBe(true);
  });

  test("not closed, and not someone else's (in any status)", () => {
    expect(isAvailableTo(issue(1, { status: 'done' }), ME, config)).toBe(false);
    expect(isAvailableTo(issue(1, { status: 'cancelled' }), ME, config)).toBe(
      false,
    );
    expect(
      isAvailableTo(issue(1, { assignee: 'bob@example.com' }), ME, config),
    ).toBe(false);
    expect(
      isAvailableTo(
        issue(1, { status: 'in_progress', assignee: 'bob' }),
        ME,
        config,
      ),
    ).toBe(false);
  });
});

describe('readyIssues', () => {
  test('sorted by priority, then ID', () => {
    const issues = [
      issue(1, { priority: 'low' }),
      issue(2, { priority: 'urgent' }),
      issue(3),
      issue(4, { priority: 'urgent' }),
    ];
    expect(ready(issues)).toEqual([2, 4, 3, 1]);
  });

  test('skips blocked, closed and other people’s issues', () => {
    const issues = [
      issue(1),
      issue(2, { blockedBy: [1] }),
      issue(3, { status: 'done' }),
      issue(4, { blockedBy: [3] }),
      issue(5, { assignee: 'bob@example.com' }),
      issue(6, { status: 'in_progress', assignee: ME.email }),
      issue(7, { blockedBy: [5] }),
    ];
    expect(ready(issues)).toEqual([1, 4, 6]);
  });

  test('cancelled and deleted blockers unblock', () => {
    const issues = [
      issue(1, { status: 'cancelled' }),
      issue(2, { blockedBy: [1] }),
      issue(3, { blockedBy: [99] }),
    ];
    expect(ready(issues)).toEqual([2, 3]);
  });

  test('a blocker that is in progress still blocks', () => {
    const issues = [
      issue(1, { status: 'in_progress', assignee: ME.email }),
      issue(2, { blockedBy: [1] }),
    ];
    expect(ready(issues)).toEqual([1]);
  });

  test('applies the list filters', () => {
    const issues = [
      issue(1, { labels: ['bug'], priority: 'high' }),
      issue(2, { labels: ['ui'] }),
      issue(3, { status: 'backlog', labels: ['bug'] }),
      issue(4, { assignee: ME.email }),
    ];
    expect(ready(issues, { label: 'bug' })).toEqual([1, 3]);
    expect(ready(issues, { status: 'todo' })).toEqual([1, 2, 4]);
    expect(ready(issues, { priority: 'high' })).toEqual([1]);
    expect(ready(issues, { mine: '1' })).toEqual([4]);
    expect(ready(issues, { sort: 'id' })).toEqual([1, 2, 3, 4]);
  });
});

describe('nextIssue', () => {
  test('the first ready issue that is not already in progress', () => {
    const list = [
      issue(1, { status: 'in_progress', assignee: ME.email }),
      issue(2),
      issue(3),
    ];
    expect(nextIssue(list, config)?.id).toBe(2);
    expect(nextIssue([list[0] as Issue], config)).toBeUndefined();
  });
});

describe('with versions elsewhere (#56)', () => {
  const claimElsewhere = (
    overrides: Partial<IssueStateElsewhere> = {},
  ): IssueStateElsewhere => ({
    ref: 'agent-1',
    worktree: '/wt/agent-1',
    status: 'in_progress',
    assignee: 'bob@example.com',
    updated: '2025-01-02T00:00:00Z',
    ...overrides,
  });

  test('isAvailableTo uses the effective (newest) state', () => {
    expect(isAvailableTo(issue(1), ME, config, [claimElsewhere()])).toBe(false);
    // Closed on another branch that isn't merged yet.
    expect(
      isAvailableTo(issue(1), ME, config, [claimElsewhere({ status: 'done' })]),
    ).toBe(false);
    // Mine elsewhere: still available to me.
    expect(
      isAvailableTo(issue(1), ME, config, [
        claimElsewhere({ assignee: ME.email }),
      ]),
    ).toBe(true);
    // Older than the local version: ignored.
    expect(
      isAvailableTo(issue(1, { updated: '2025-01-03T00:00:00Z' }), ME, config, [
        claimElsewhere(),
      ]),
    ).toBe(true);
    // A newer release elsewhere frees a local claim.
    expect(
      isAvailableTo(
        issue(1, { status: 'in_progress', assignee: 'bob' }),
        ME,
        config,
        [claimElsewhere({ status: 'todo', assignee: '' })],
      ),
    ).toBe(true);
  });

  test('ready skips issues claimed elsewhere; next skips my claims elsewhere', () => {
    const issues = [issue(1), issue(2), issue(3)];
    const elsewhere = new Map([
      [1, [claimElsewhere()]],
      [2, [claimElsewhere({ assignee: ME.email })]],
    ]);
    const query = parseIssueQuery({ sort: 'priority' }, config);
    const list = readyIssues(
      issues,
      indexIssues(issues),
      ME,
      query,
      config,
      elsewhere,
    );
    expect(list.map((i) => i.id)).toEqual([2, 3]);
    expect(nextIssue(list, config, elsewhere)?.id).toBe(3);
    expect(nextIssue(list, config)?.id).toBe(2);
  });
});

describe('with a review status (#105)', () => {
  const review = {
    ...config,
    statuses: [...config.statuses, { name: 'review', closed: false }],
    reviewStatus: 'review',
  };

  test('next skips my issues in review, here or elsewhere', () => {
    const list = [
      issue(1, { status: 'review', assignee: ME.email }),
      issue(2),
      issue(3),
    ];
    expect(nextIssue(list, review)?.id).toBe(2);
    // Without a review status, review is just an open status.
    expect(nextIssue(list, config)?.id).toBe(1);
    const elsewhere = new Map([
      [
        2,
        [
          {
            ref: 'agent-1',
            status: 'review',
            assignee: ME.email,
            updated: '2025-01-02T00:00:00Z',
          },
        ],
      ],
    ]);
    expect(nextIssue(list, review, elsewhere)?.id).toBe(3);
  });

  test("someone else's issue in review elsewhere is not available", () => {
    expect(
      isAvailableTo(issue(1), ME, review, [
        {
          ref: 'agent-1',
          status: 'review',
          assignee: 'bob@example.com',
          updated: '2025-01-02T00:00:00Z',
        },
      ]),
    ).toBe(false);
  });
});
