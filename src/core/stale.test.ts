import { describe, expect, test } from 'bun:test';
import { createDefaultConfig } from './config.ts';
import type { IssueStateElsewhere } from './elsewhere.ts';
import { GitracError } from './errors.ts';
import {
  claimAge,
  formatDuration,
  parseDuration,
  staleClaim,
  staleOptions,
} from './stale.ts';

/** Regression tests for #106: stale claims of crashed or timed-out agents. */

const CONFIG = createDefaultConfig();
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-01-02T12:00:00.000Z');
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * HOUR).toISOString();
const opts = { maxAgeMs: 2 * HOUR, now: NOW };

const claimed = (hoursAgo: number) => ({
  status: 'in_progress' as const,
  assignee: 'bob@example.com',
  updated: at(hoursAgo),
});

function state(
  hoursAgo: number,
  overrides: Partial<IssueStateElsewhere> = {},
): IssueStateElsewhere {
  return {
    ref: 'agent-1',
    worktree: '/wt/agent-1',
    status: 'in_progress',
    assignee: 'bob@example.com',
    updated: at(hoursAgo),
    ...overrides,
  };
}

describe('parseDuration', () => {
  test('accepts a whole number and one unit', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('45m')).toBe(45 * 60_000);
    expect(parseDuration('2h')).toBe(2 * HOUR);
    expect(parseDuration('1d')).toBe(24 * HOUR);
    expect(parseDuration(' 2h ')).toBe(2 * HOUR);
  });

  test('rejects anything else with invalid_input', () => {
    for (const text of ['', '2', 'h', '0h', '-1h', '1.5h', '2H', '2 h', '1w']) {
      let err: unknown;
      try {
        parseDuration(text);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(GitracError);
      expect((err as GitracError).code).toBe('invalid_input');
      expect((err as GitracError).message).toContain(`"${text}"`);
    }
  });

  test('staleOptions: undefined without a duration', () => {
    expect(staleOptions(undefined)).toBeUndefined();
    expect(staleOptions('2h', NOW)).toEqual({ maxAgeMs: 2 * HOUR, now: NOW });
  });
});

describe('formatDuration', () => {
  test('uses the largest whole unit', () => {
    expect(formatDuration(90 * 60_000)).toBe('1h');
    expect(formatDuration(3 * 24 * HOUR)).toBe('3d');
    expect(formatDuration(5 * 60_000)).toBe('5m');
    expect(formatDuration(1500)).toBe('1s');
    expect(formatDuration(-5)).toBe('0s');
  });
});

describe('staleClaim', () => {
  test('a local claim older than the threshold is stale', () => {
    expect(staleClaim(claimed(3), CONFIG, [], opts)).toEqual({
      assignee: 'bob@example.com',
      updated: at(3),
    });
    // Exactly at the threshold counts.
    expect(staleClaim(claimed(2), CONFIG, [], opts)).toBeDefined();
  });

  test('a fresh claim is not stale', () => {
    expect(staleClaim(claimed(1), CONFIG, [], opts)).toBeUndefined();
  });

  test('unassigned or not in the active status is not stale', () => {
    expect(
      staleClaim({ ...claimed(3), assignee: '' }, CONFIG, [], opts),
    ).toBeUndefined();
    expect(
      staleClaim({ ...claimed(3), status: 'todo' }, CONFIG, [], opts),
    ).toBeUndefined();
  });

  test('a claim in the review status is never stale', () => {
    const review = {
      ...CONFIG,
      statuses: [...CONFIG.statuses, { name: 'review', closed: false }],
      reviewStatus: 'review',
    };
    expect(
      staleClaim({ ...claimed(30), status: 'review' }, review, [], opts),
    ).toBeUndefined();
    expect(
      staleClaim(
        { ...claimed(30), status: 'todo' },
        review,
        [state(20, { status: 'review' })],
        opts,
      ),
    ).toBeUndefined();
  });

  test('judged by the effective (newest) version, saying where', () => {
    const local = { status: 'todo' as const, assignee: '', updated: at(10) };
    expect(staleClaim(local, CONFIG, [state(3)], opts)).toEqual({
      assignee: 'bob@example.com',
      updated: at(3),
      ref: 'agent-1',
      worktree: '/wt/agent-1',
    });
    // A newer, fresh version (activity elsewhere) is not stale.
    expect(staleClaim(claimed(5), CONFIG, [state(1)], opts)).toBeUndefined();
    // On a branch: no worktree key.
    const { worktree: _, ...onBranch } = state(3);
    expect(staleClaim(local, CONFIG, [onBranch], opts)).toEqual({
      assignee: 'bob@example.com',
      updated: at(3),
      ref: 'agent-1',
    });
    // A newer release elsewhere: not a claim.
    expect(
      staleClaim(
        claimed(5),
        CONFIG,
        [state(3, { assignee: '', status: 'todo' })],
        opts,
      ),
    ).toBeUndefined();
  });

  test('an unparseable updated is never stale', () => {
    expect(
      staleClaim({ ...claimed(0), updated: 'soon' }, CONFIG, [], opts),
    ).toBeUndefined();
    expect(claimAge({ updated: 'soon' }, [], NOW)).toBeUndefined();
    expect(claimAge(claimed(3), [state(1)], NOW)).toBe(HOUR);
  });

  test('uses the configured active status', () => {
    const custom = { ...CONFIG, activeStatus: 'doing' };
    expect(staleClaim(claimed(3), custom, [], opts)).toBeUndefined();
    expect(
      staleClaim({ ...claimed(3), status: 'doing' }, custom, [], opts),
    ).toBeDefined();
  });
});
