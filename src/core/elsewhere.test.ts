import { describe, expect, test } from 'bun:test';
import { createDefaultConfig } from './config.ts';
import {
  claimedElsewhere,
  closedElsewhere,
  describeLocation,
  effectiveState,
  elsewhereMarks,
  type IssueStateElsewhere,
  isLater,
  newestElsewhere,
} from './elsewhere.ts';

/** Regression tests for #56: claims visible across worktrees and branches. */

const CONFIG = createDefaultConfig();

const local = {
  status: 'todo' as const,
  assignee: '',
  updated: '2026-01-02T00:00:00.000Z',
};

function state(
  updated: string,
  overrides: Partial<IssueStateElsewhere> = {},
): IssueStateElsewhere {
  return {
    ref: 'feature',
    status: 'in_progress',
    assignee: 'bob@example.com',
    updated,
    ...overrides,
  };
}

describe('isLater', () => {
  test('compares as timestamps, falling back to string order', () => {
    expect(isLater('2026-01-02T00:00:00Z', '2026-01-01T23:59:59.999Z')).toBe(
      true,
    );
    // Same instant, different spelling: not later.
    expect(isLater('2026-01-02T00:00:00Z', '2026-01-02T00:00:00.000Z')).toBe(
      false,
    );
    expect(isLater('b', 'a')).toBe(true);
    expect(isLater('2026-01-01T00:00:00Z', '')).toBe(true);
  });
});

describe('newestElsewhere / effectiveState', () => {
  test('a newer version elsewhere is the effective one', () => {
    const newer = state('2026-01-03T00:00:00Z');
    expect(newestElsewhere(local, [newer])).toBe(newer);
    expect(effectiveState(local, [newer])).toMatchObject({
      status: 'in_progress',
      assignee: 'bob@example.com',
    });
  });

  test('older versions elsewhere and ties lose to the local one', () => {
    const states = [
      state('2026-01-01T00:00:00Z'),
      state(local.updated, { ref: 'tie' }),
    ];
    expect(newestElsewhere(local, states)).toBeUndefined();
    expect(effectiveState(local, states)).toBe(local);
    expect(newestElsewhere(local)).toBeUndefined();
  });

  test('the newest wins; equal timestamps go to the earlier state', () => {
    const a = state('2026-01-03T00:00:00Z', { ref: 'a', worktree: '/wt/a' });
    const b = state('2026-01-03T00:00:00Z', { ref: 'a' });
    const c = state('2026-01-04T00:00:00Z', { ref: 'c', status: 'todo' });
    expect(newestElsewhere(local, [a, b])).toBe(a);
    expect(newestElsewhere(local, [a, c, b])).toBe(c);
  });
});

describe('claimedElsewhere', () => {
  test('where and by whom, when the newest version is a claim', () => {
    expect(
      claimedElsewhere(local, CONFIG, [
        state('2026-01-03T00:00:00Z', { worktree: '/wt/a' }),
      ]),
    ).toEqual({
      ref: 'feature',
      worktree: '/wt/a',
      assignee: 'bob@example.com',
      updated: '2026-01-03T00:00:00Z',
    });
    expect(
      claimedElsewhere(local, CONFIG, [state('2026-01-03T00:00:00Z')]),
    ).toEqual({
      ref: 'feature',
      assignee: 'bob@example.com',
      updated: '2026-01-03T00:00:00Z',
    });
  });

  test('a newer unclaim or close supersedes a claim', () => {
    const claim = state('2026-01-03T00:00:00Z');
    for (const later of [
      state('2026-01-04T00:00:00Z', { status: 'todo', assignee: '' }),
      state('2026-01-04T00:00:00Z', { status: 'done' }),
    ]) {
      expect(claimedElsewhere(local, CONFIG, [claim, later])).toBeUndefined();
    }
    // ... and so does a newer local version.
    expect(
      claimedElsewhere({ updated: '2026-01-05T00:00:00Z' }, CONFIG, [claim]),
    ).toBeUndefined();
  });

  test('in progress but unassigned is not a claim', () => {
    expect(
      claimedElsewhere(local, CONFIG, [
        state('2026-01-03T00:00:00Z', { assignee: ' ' }),
      ]),
    ).toBeUndefined();
  });
});

describe('closedElsewhere (#93)', () => {
  test('where, in which status and when, when the newest version is closed', () => {
    expect(
      closedElsewhere(local, CONFIG, [
        state('2026-01-03T00:00:00Z', { status: 'done', worktree: '/wt/a' }),
      ]),
    ).toEqual({
      ref: 'feature',
      worktree: '/wt/a',
      status: 'done',
      updated: '2026-01-03T00:00:00Z',
    });
    expect(
      closedElsewhere(local, CONFIG, [
        state('2026-01-03T00:00:00Z', { status: 'cancelled' }),
      ]),
    ).toEqual({
      ref: 'feature',
      status: 'cancelled',
      updated: '2026-01-03T00:00:00Z',
    });
  });

  test('an older close, a newer open version or a local close is not reported', () => {
    const done = state('2026-01-03T00:00:00Z', { status: 'done' });
    // Older than the local version.
    expect(
      closedElsewhere({ ...local, updated: '2026-01-04T00:00:00Z' }, CONFIG, [
        done,
      ]),
    ).toBeUndefined();
    // Superseded by a newer reopen elsewhere.
    expect(
      closedElsewhere(local, CONFIG, [
        done,
        state('2026-01-04T00:00:00Z', { status: 'todo', assignee: '' }),
      ]),
    ).toBeUndefined();
    // Closed here too: nothing to flag.
    expect(
      closedElsewhere({ ...local, status: 'done' }, CONFIG, [done]),
    ).toBeUndefined();
    // A claim is not a close.
    expect(
      closedElsewhere(local, CONFIG, [state('2026-01-03T00:00:00Z')]),
    ).toBeUndefined();
  });

  test('custom closed statuses come from the config', () => {
    const config = {
      ...CONFIG,
      statuses: [
        { name: 'open', closed: false },
        { name: 'done', closed: false },
        { name: 'shipped', closed: true },
      ],
      defaultStatus: 'open',
    };
    const shipped = state('2026-01-03T00:00:00Z', { status: 'shipped' });
    expect(
      closedElsewhere({ ...local, status: 'open' }, config, [shipped])?.status,
    ).toBe('shipped');
    // `done` is an open status in this config.
    expect(
      closedElsewhere({ ...local, status: 'open' }, config, [
        state('2026-01-03T00:00:00Z', { status: 'done' }),
      ]),
    ).toBeUndefined();
  });

  test('elsewhereMarks sets one of claimedElsewhere / closedElsewhere', () => {
    expect(
      elsewhereMarks(local, CONFIG, [state('2026-01-03T00:00:00Z')]),
    ).toEqual({
      claimedElsewhere: {
        ref: 'feature',
        assignee: 'bob@example.com',
        updated: '2026-01-03T00:00:00Z',
      },
    });
    expect(
      elsewhereMarks(local, CONFIG, [
        state('2026-01-03T00:00:00Z', { status: 'done' }),
      ]),
    ).toEqual({
      closedElsewhere: {
        ref: 'feature',
        status: 'done',
        updated: '2026-01-03T00:00:00Z',
      },
    });
    expect(elsewhereMarks(local, CONFIG, [])).toBeUndefined();
  });
});

describe('describeLocation', () => {
  test('branch, worktree branch, detached worktree', () => {
    expect(describeLocation({ ref: 'origin/x' })).toBe('on branch origin/x');
    expect(describeLocation({ ref: 'x', worktree: '/wt' })).toBe(
      'in worktree /wt (branch x)',
    );
    expect(describeLocation({ ref: 'HEAD', worktree: '/wt' })).toBe(
      'in worktree /wt (detached HEAD)',
    );
  });
});
