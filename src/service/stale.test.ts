import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createDefaultConfig } from '../core/config.ts';
import type { GitracError } from '../core/errors.ts';
import { parseIssueQuery } from '../core/query.ts';
import {
  readConfig,
  readIssue,
  writeConfig,
  writeIssue,
} from '../fs/issue-store.ts';
import { claimIssue, unclaimIssue } from './claim.ts';
import { listIssues } from './list.ts';
import { claimNextIssue, findNextIssue, listReadyIssues } from './ready.ts';
import {
  ADA,
  makeIssue,
  type ServiceFixture,
  serviceFixture,
} from './test-helpers.fixture.ts';

/** Regression tests for #106: stale claims (service layer). */

const HOUR = 60 * 60 * 1000;
const ago = (hours: number) =>
  new Date(Date.now() - hours * HOUR).toISOString();
const stale = () => ({ maxAgeMs: 2 * HOUR, now: Date.now() });
const config = createDefaultConfig();
const query = parseIssueQuery({ sort: 'priority' }, config);

let fx: ServiceFixture;

beforeEach(async () => {
  fx = await serviceFixture();
  // #1: Bob's stale claim; #2: Bob's fresh claim; #3: free, low priority.
  await writeIssue(
    fx.dir,
    makeIssue({
      id: 1,
      title: 'One',
      status: 'in_progress',
      assignee: 'bob@example.com',
      updated: ago(3),
    }),
  );
  await writeIssue(
    fx.dir,
    makeIssue({
      id: 2,
      title: 'Two',
      priority: 'urgent',
      status: 'in_progress',
      assignee: 'bob@example.com',
      updated: ago(1),
    }),
  );
  await writeIssue(
    fx.dir,
    makeIssue({ id: 3, title: 'Three', status: 'todo', priority: 'low' }),
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

describe('listIssues with stale', () => {
  test('lists only stale claims, with staleClaim', async () => {
    const result = await listIssues(fx.dir, query, config, { stale: stale() });
    expect(result.issues.map((i) => i.id)).toEqual([1]);
    expect(result.staleClaims.get(1)).toEqual({
      assignee: 'bob@example.com',
      updated: (await readIssue(fx.dir, 1)).updated,
    });
    // Without stale: unchanged.
    const all = await listIssues(fx.dir, query, config);
    expect(all.issues.map((i) => i.id)).toEqual([2, 1, 3]);
    expect(all.staleClaims.size).toBe(0);
  });
});

describe('ready / next with stale', () => {
  test('a stale claim is ready and picked; a fresh one is not', async () => {
    const plain = await listReadyIssues(fx.dir, ADA, query, config);
    expect(plain.issues.map((i) => i.id)).toEqual([3]);

    const listing = await listReadyIssues(fx.dir, ADA, query, config, {
      stale: stale(),
    });
    expect(listing.issues.map((i) => i.id)).toEqual([1, 3]);
    expect([...listing.staleClaims.keys()]).toEqual([1]);
    const next = await findNextIssue(fx.dir, ADA, query, config, {
      stale: stale(),
    });
    expect(next.issue.id).toBe(1);
    expect(next.staleClaim?.assignee).toBe('bob@example.com');
  });

  test('next --claim takes over the stale claim', async () => {
    const result = await claimNextIssue(fx.context(), query, {
      stale: stale(),
    });
    expect(result.changed).toBe(true);
    if (!result.changed) return;
    expect(result.issue).toMatchObject({
      id: 1,
      assignee: ADA.email,
      status: 'in_progress',
    });
    expect(result.staleClaim?.assignee).toBe('bob@example.com');
    expect(fx.commits[0]?.message).toBe('issue: claim #1 One');
    // Without stale, next goes on with the free issue.
    const plain = await claimNextIssue(fx.context(), query);
    expect(plain.issue.id).toBe(3);
  });
});

describe('claimIssue / unclaimIssue with stale', () => {
  test('claim takes over a stale claim only', async () => {
    const taken = await claimIssue(fx.context(), 1, { stale: stale() });
    expect(taken.changed && taken.staleClaim?.assignee).toBe('bob@example.com');
    expect((await readIssue(fx.dir, 1)).assignee).toBe(ADA.email);

    const err = await rejection(
      claimIssue(fx.context(), 2, { stale: stale() }),
    );
    expect(err.code).toBe('already_claimed');
    expect(err.message).toBe(
      'Issue #2 is already claimed by bob@example.com (in_progress). Its last activity was 1h ago, less than 2h.',
    );
  });

  test('unclaim releases a stale claim of someone else without force', async () => {
    const released = await unclaimIssue(fx.context(), 1, { stale: stale() });
    expect(released.changed && released.staleClaim?.assignee).toBe(
      'bob@example.com',
    );
    expect(await readIssue(fx.dir, 1)).toMatchObject({
      assignee: '',
      status: 'todo',
    });

    const err = await rejection(
      unclaimIssue(fx.context(), 2, { stale: stale() }),
    );
    expect(err.code).toBe('already_claimed');
    expect(err.message).toBe(
      'Issue #2 is claimed by bob@example.com, not you. Its last activity was 1h ago, less than 2h.',
    );
    expect((await readIssue(fx.dir, 2)).assignee).toBe('bob@example.com');
  });

  test('a claim in the review status is never stale', async () => {
    const cfg = await readConfig(fx.dir);
    cfg.statuses.splice(3, 0, { name: 'review', closed: false });
    cfg.reviewStatus = 'review';
    await writeConfig(fx.dir, cfg);
    await writeIssue(
      fx.dir,
      makeIssue({
        id: 1,
        title: 'One',
        status: 'review',
        assignee: 'bob@example.com',
        updated: ago(30),
      }),
    );
    const err = await rejection(
      unclaimIssue(fx.context(), 1, { stale: stale() }),
    );
    expect(err.code).toBe('already_claimed');
    expect(err.message).toContain('A claim in review is never stale.');
    const listing = await listReadyIssues(fx.dir, ADA, query, cfg, {
      stale: stale(),
    });
    expect(listing.issues.map((i) => i.id)).toEqual([3]);
  });

  test('renew bumps updated of my own claim and commits renew', async () => {
    await writeIssue(
      fx.dir,
      makeIssue({
        id: 4,
        title: 'Mine',
        status: 'in_progress',
        assignee: ADA.email,
        updated: ago(3),
      }),
    );
    // Without renew: a no-op, as before.
    expect((await claimIssue(fx.context(), 4)).changed).toBe(false);
    const renewed = await claimIssue(fx.context(), 4, { renew: true });
    expect(renewed.changed && renewed.renewed).toBe(true);
    expect(fx.commits.map((c) => c.message)).toEqual(['issue: renew #4 Mine']);
    const issue = await readIssue(fx.dir, 4);
    expect(Date.now() - Date.parse(issue.updated)).toBeLessThan(HOUR);
    // Now fresh: not listed as stale.
    const listed = await listIssues(fx.dir, query, config, { stale: stale() });
    expect(listed.issues.map((i) => i.id)).toEqual([1]);
    // On someone else's claim, renew is a normal claim.
    const err = await rejection(claimIssue(fx.context(), 2, { renew: true }));
    expect(err.code).toBe('already_claimed');
  });
});
