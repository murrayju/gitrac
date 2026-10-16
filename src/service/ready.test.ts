import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createDefaultConfig } from '../core/config.ts';
import type { GitracError } from '../core/errors.ts';
import { parseIssueQuery } from '../core/query.ts';
import { readIssue, writeIssue } from '../fs/issue-store.ts';
import { claimNextIssue, findNextIssue, listReadyIssues } from './ready.ts';
import {
  ADA,
  makeIssue,
  type ServiceFixture,
  serviceFixture,
} from './test-helpers.fixture.ts';

/** Regression tests for #55: `gitrac ready` / `next [--claim]`. */

let fx: ServiceFixture;
const config = createDefaultConfig();
const query = parseIssueQuery({ sort: 'priority' }, config);

beforeEach(async () => {
  fx = await serviceFixture();
  // #1 done (closed dir) unblocks #2; #3 is blocked by the open #4.
  await writeIssue(fx.dir, makeIssue({ id: 1, status: 'done' }), {
    closed: true,
  });
  await writeIssue(fx.dir, makeIssue({ id: 2, title: 'Two', blockedBy: [1] }));
  await writeIssue(
    fx.dir,
    makeIssue({ id: 3, title: 'Three', priority: 'urgent', blockedBy: [4] }),
  );
  await writeIssue(
    fx.dir,
    makeIssue({ id: 4, title: 'Four', priority: 'high' }),
  );
  await writeIssue(
    fx.dir,
    makeIssue({ id: 5, title: 'Five', assignee: 'bob@example.com' }),
  );
});

afterEach(async () => {
  await fx.cleanup();
});

async function rejection(promise: Promise<unknown>): Promise<GitracError> {
  try {
    await promise;
  } catch (err) {
    return err as GitracError;
  }
  throw new Error('expected the operation to fail');
}

describe('listReadyIssues', () => {
  test('reads closed blockers from .issues/closed/', async () => {
    const { issues } = await listReadyIssues(fx.dir, ADA, query, config);
    expect(issues.map((i) => i.id)).toEqual([4, 2]);
  });
});

describe('findNextIssue', () => {
  test('is the top ready issue', async () => {
    expect((await findNextIssue(fx.dir, ADA, query, config)).issue.id).toBe(4);
  });
});

describe('claimNextIssue', () => {
  test('claims the top ready issue', async () => {
    const result = await claimNextIssue(fx.context(), query, {
      comment: 'on it',
    });
    expect(result.changed).toBe(true);
    expect(result.issue).toMatchObject({
      id: 4,
      status: 'in_progress',
      assignee: ADA.email,
    });
    expect(fx.commits.map((c) => c.message)).toEqual(['issue: claim #4 Four']);
  });

  test('concurrent claims each get a different issue', async () => {
    const results = await Promise.allSettled([
      claimNextIssue(fx.context(), query),
      claimNextIssue(fx.context(), query),
      claimNextIssue(fx.context(), query),
    ]);
    const claimed = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value.issue.id)
      .sort();
    expect(claimed).toEqual([2, 4]);
    const failed = results.filter((r) => r.status === 'rejected');
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason.code).toBe(
      'no_ready_issues',
    );
    expect((await readIssue(fx.dir, 2)).assignee).toBe(ADA.email);
  });

  test('throws no_ready_issues (exit 5) when nothing is ready', async () => {
    const none = parseIssueQuery({ label: 'nope' }, config);
    const err = await rejection(claimNextIssue(fx.context(), none));
    expect(err.code).toBe('no_ready_issues');
    expect(err.exitCode).toBe(5);
    expect(fx.commits).toEqual([]);
  });
});

describe('claimNextIssue identity validation (#98)', () => {
  test('an identity with a line break is invalid_input before an issue is picked', async () => {
    const ctx = fx.context({
      identity: async () => ({ name: 'Ada\nL', email: '' }),
    });
    const err = await rejection(claimNextIssue(ctx, query));
    expect(err.code).toBe('invalid_input');
    expect((await readIssue(fx.dir, 4)).assignee).toBe('');
    expect(fx.events).toEqual([]);
  });
});
