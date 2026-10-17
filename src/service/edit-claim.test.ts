import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { claimedElsewhere } from '../core/elsewhere.ts';
import type { GitracError } from '../core/errors.ts';
import { readConfig, readIssue, writeIssue } from '../fs/issue-store.ts';
import { issueStatesElsewhere } from '../git/elsewhere.ts';
import { updateIssue } from './issues.ts';
import {
  ADA,
  makeIssue,
  type ServiceFixture,
  serviceFixture,
} from './test-helpers.fixture.ts';

/**
 * Regression tests for #108: `updateIssue` (`gitrac edit`, `PATCH
 * /api/issues/:id`) must not overwrite a claim held by someone else, here or
 * in another worktree, unless `force`.
 */

const BOB = 'bob@example.com';
const NOW = '2026-01-02T00:00:00.000Z';
const LATER = '2026-01-03T00:00:00.000Z';

let fx: ServiceFixture;
let tmp: string;
let wt: string;

beforeEach(async () => {
  fx = await serviceFixture();
  tmp = await realpath(await mkdtemp(join(tmpdir(), 'gitrac-edit-claim-')));
  const git = simpleGit(fx.dir);
  await git.raw(['init', '-b', 'main']);
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Task', status: 'todo' }));
  await writeIssue(
    fx.dir,
    makeIssue({ id: 2, title: 'Taken', status: 'in_progress', assignee: BOB }),
  );
  await git.add('.');
  await git.commit('init');
  wt = join(tmp, 'wt-1');
  await git.raw(['worktree', 'add', '-b', 'agent-1', wt]);
});

afterEach(async () => {
  setSystemTime();
  await fx.cleanup();
  await rm(tmp, { recursive: true, force: true });
});

async function rejection(promise: Promise<unknown>): Promise<GitracError> {
  try {
    await promise;
  } catch (err) {
    return err as GitracError;
  }
  throw new Error('expected the operation to fail');
}

/** Claim issue #1 in the other worktree (uncommitted), as `assignee`. */
async function claimInWorktree(assignee: string, updated = LATER) {
  await writeIssue(
    wt,
    makeIssue({
      id: 1,
      title: 'Task',
      status: 'in_progress',
      assignee,
      updated,
    }),
  );
}

/** The claim elsewhere that is in effect for the local issue #1, if any. */
async function effectiveClaimElsewhere() {
  const local = await readIssue(fx.dir, 1);
  const states = (await issueStatesElsewhere(fx.dir, { ids: [1] })).get(1);
  return claimedElsewhere(local, await readConfig(fx.dir), states);
}

describe('updateIssue and claims (#108)', () => {
  test("a status or assignee change of someone else's local claim is already_claimed", async () => {
    for (const fields of [{ status: 'todo' }, { assignee: 'Ada' }]) {
      const err = await rejection(updateIssue(fx.context(), 2, fields));
      expect(err.code).toBe('already_claimed');
      // Surface-neutral: no CLI flags (adapters add hints)
      expect(err.message).toBe(
        `Issue #2 is already claimed by ${BOB} (in_progress).`,
      );
      expect(err.details).toEqual({ id: 2, assignee: BOB });
    }
    expect(await readIssue(fx.dir, 2)).toMatchObject({
      status: 'in_progress',
      assignee: BOB,
    });
    expect(fx.events).toEqual([]);
  });

  test('a claim in another worktree is refused, saying where', async () => {
    await claimInWorktree(BOB);
    const err = await rejection(
      updateIssue(fx.context(), 1, { status: 'in_progress', assignee: 'Ada' }),
    );
    expect(err.code).toBe('already_claimed');
    expect(err.message).toBe(
      `Issue #1 is already claimed by ${BOB} (in_progress) in worktree ${wt} (branch agent-1).`,
    );
    expect(err.details).toMatchObject({
      id: 1,
      assignee: BOB,
      claimedElsewhere: { ref: 'agent-1', worktree: wt, assignee: BOB },
    });
    expect((await readIssue(fx.dir, 1)).status).toBe('todo');
  });

  test('force changes it, superseding the claim elsewhere', async () => {
    await claimInWorktree(BOB, LATER);
    setSystemTime(new Date(NOW));
    const result = await updateIssue(
      fx.context(),
      1,
      { assignee: 'Ada' },
      { force: true, comment: 'mine now' },
    );
    expect(result.changed).toBe(true);
    // Strictly later than the claim elsewhere (its clock is ahead).
    expect(result.issue.updated).toBe('2026-01-03T00:00:00.001Z');
    expect(result.issue.comments.at(-1)?.timestamp).toBe(result.issue.updated);
    expect(await effectiveClaimElsewhere()).toBeUndefined();
  });

  test('the claim holder can change the status and the assignee', async () => {
    await claimInWorktree(ADA.email);
    const result = await updateIssue(fx.context(), 1, { status: 'todo' });
    expect(result.issue.status).toBe('todo');
    const holder = fx.context({
      identity: async () => ({ name: 'Bob', email: BOB }),
    });
    const released = await updateIssue(holder, 2, { assignee: '' });
    expect(released.issue.assignee).toBe('');
  });

  test('edits of other fields are allowed, with no scan elsewhere', async () => {
    await claimInWorktree(BOB, LATER);
    setSystemTime(new Date(NOW));
    const result = await updateIssue(fx.context(), 1, {
      title: 'Renamed',
      priority: 'high',
      labels: ['bug'],
      description: 'New text',
    });
    expect(result.changed).toBe(true);
    // Not pushed past the claim elsewhere: no scan ran, and the claim
    // stays in effect.
    expect(result.issue.updated).toBe(NOW);
    expect((await effectiveClaimElsewhere())?.assignee).toBe(BOB);
    expect((await updateIssue(fx.context(), 2, { title: 'X' })).changed).toBe(
      true,
    );
  });

  test('a no-op is still a no-op, even on a claim held by someone else', async () => {
    const result = await updateIssue(fx.context(), 2, {
      status: 'in_progress',
      assignee: BOB,
    });
    expect(result.changed).toBe(false);
    expect(fx.events).toEqual([]);
  });

  test('an unclaimed issue can be changed (claimed) by an edit', async () => {
    const result = await updateIssue(fx.context(), 1, {
      status: 'in_progress',
      assignee: 'someone',
    });
    expect(result.issue).toMatchObject({
      status: 'in_progress',
      assignee: 'someone',
    });
    // Now held by "someone": another change by Ada is refused.
    const err = await rejection(
      updateIssue(fx.context(), 1, { status: 'todo' }),
    );
    expect(err.code).toBe('already_claimed');
  });
});
