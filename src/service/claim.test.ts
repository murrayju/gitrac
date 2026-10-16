import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { claimedElsewhere } from '../core/elsewhere.ts';
import type { GitracError } from '../core/errors.ts';
import { serializeIssue } from '../core/issue.ts';
import type { Issue } from '../core/types.ts';
import {
  findIssueFile,
  listAllIssueFiles,
  readConfig,
  readIssue,
  writeConfig,
  writeIssue,
} from '../fs/issue-store.ts';
import { issueStatesElsewhere } from '../git/elsewhere.ts';
import { claimIssue, submitForReview, unclaimIssue } from './claim.ts';
import {
  ADA,
  makeIssue,
  type ServiceFixture,
  serviceFixture,
} from './test-helpers.fixture.ts';

let fx: ServiceFixture;

beforeEach(async () => {
  fx = await serviceFixture();
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

/** Write `issue` as `.issues/[closed/]<filename>`, ignoring its title. */
async function writeAs(issue: Issue, filename: string, closed = false) {
  const base = closed ? join('.issues', 'closed') : '.issues';
  await writeFile(join(fx.dir, base, filename), serializeIssue(issue));
}

describe('claimIssue', () => {
  test('assigns to the identity email, sets in_progress, registers the assignee', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Task' }));
    const result = await claimIssue(fx.context(), 1, { comment: 'mine' });

    expect(result.changed).toBe(true);
    if (!result.changed) return;
    expect(result.issue).toMatchObject({
      assignee: ADA.email,
      status: 'in_progress',
      comments: [{ author: 'Ada', body: 'mine' }],
    });
    expect(result.paths).toEqual([
      join('.issues', '1-task.md'),
      join('.issues', 'config.yaml'),
    ]);
    expect(fx.commits[0]?.message).toBe('issue: claim #1 Task');
    expect((await readConfig(fx.dir)).assignees).toContainEqual({
      name: 'Ada',
      email: ADA.email,
    });
  });

  test('the comment is trimmed; a blank one adds nothing', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Task' }));
    const claimed = await claimIssue(fx.context(), 1, { comment: ' mine\n' });
    expect(claimed.issue.comments).toMatchObject([{ body: 'mine' }]);
    const released = await unclaimIssue(fx.context(), 1, { comment: '  ' });
    expect(released.issue.comments).toHaveLength(1);
  });

  test('claiming your own in-progress issue is a no-op', async () => {
    await writeIssue(
      fx.dir,
      makeIssue({ id: 1, status: 'in_progress', assignee: ADA.email }),
    );
    const result = await claimIssue(fx.context(), 1, { comment: 'x' });
    expect(result.changed).toBe(false);
    expect(result.issue.comments).toEqual([]);
    expect(fx.events).toEqual([]);
  });

  test('someone else’s issue is already_claimed unless forced', async () => {
    await writeIssue(
      fx.dir,
      makeIssue({ id: 1, status: 'in_progress', assignee: 'bob@x.com' }),
    );
    const err = await rejection(claimIssue(fx.context(), 1));
    expect(err.code).toBe('already_claimed');
    // Surface-neutral: no CLI flags (adapters add hints)
    expect(err.message).toBe(
      'Issue #1 is already claimed by bob@x.com (in_progress).',
    );
    expect(err.details).toEqual({ id: 1, assignee: 'bob@x.com' });
    expect((await readIssue(fx.dir, 1)).assignee).toBe('bob@x.com');

    const forced = await claimIssue(fx.context(), 1, { force: true });
    expect(forced.issue.assignee).toBe(ADA.email);
  });

  test('a closed issue is issue_closed; --force reopens it into .issues/', async () => {
    await writeIssue(
      fx.dir,
      makeIssue({ id: 1, title: 'Old', status: 'done' }),
      {
        closed: true,
      },
    );
    const err = await rejection(claimIssue(fx.context(), 1));
    expect(err.code).toBe('issue_closed');
    expect(err.message).toBe('Issue #1 is closed (done).');

    const result = await claimIssue(fx.context(), 1, { force: true });
    expect(result.changed && result.paths).toEqual([
      join('.issues', '1-old.md'),
      join('.issues', 'closed', '1-old.md'),
      join('.issues', 'config.yaml'),
    ]);
    expect(await findIssueFile(fx.dir, 1)).toEqual({
      filename: '1-old.md',
      closed: false,
    });
  });
});

describe('claim / unclaim on a file whose name does not match its title', () => {
  const stale = join('.issues', '1-old-title.md');
  const current = join('.issues', '1-new-title.md');

  test('claim replaces the stale file and commits the deletion', async () => {
    await writeAs(makeIssue({ id: 1, title: 'New title' }), '1-old-title.md');
    const result = await claimIssue(fx.context(), 1);
    expect(result.changed && result.paths).toEqual([
      current,
      stale,
      join('.issues', 'config.yaml'),
    ]);
    expect(fx.commits[0]?.files).toEqual([
      current,
      stale,
      join('.issues', 'config.yaml'),
    ]);
    expect(await listAllIssueFiles(fx.dir)).toEqual(['1-new-title.md']);
    expect((await readIssue(fx.dir, 1)).status).toBe('in_progress');
  });

  test('claim --force of a misnamed closed issue moves and renames it', async () => {
    await writeAs(
      makeIssue({ id: 1, title: 'New title', status: 'done' }),
      '1-old-title.md',
      true,
    );
    const result = await claimIssue(fx.context(), 1, { force: true });
    expect(result.changed && result.paths).toEqual([
      current,
      join('.issues', 'closed', '1-old-title.md'),
      join('.issues', 'config.yaml'),
    ]);
    expect(await listAllIssueFiles(fx.dir)).toEqual(['1-new-title.md']);
  });

  test('unclaim replaces the stale file too', async () => {
    await writeAs(
      makeIssue({
        id: 1,
        title: 'New title',
        status: 'in_progress',
        assignee: ADA.email,
      }),
      '1-old-title.md',
    );
    const result = await unclaimIssue(fx.context(), 1);
    expect(result.changed && result.paths).toEqual([current, stale]);
    expect(await listAllIssueFiles(fx.dir)).toEqual(['1-new-title.md']);
  });

  test('duplicate files for the ID fail with duplicate_issue', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'New title' }));
    await writeAs(makeIssue({ id: 1, title: 'New title' }), '1-old-title.md');
    const err = await rejection(claimIssue(fx.context(), 1));
    expect(err.code).toBe('duplicate_issue');
    expect(fx.commits).toEqual([]);
    expect((await listAllIssueFiles(fx.dir)).toSorted()).toEqual([
      '1-new-title.md',
      '1-old-title.md',
    ]);
  });
});

describe('unclaimIssue', () => {
  test('clears the assignee and moves in_progress back to todo', async () => {
    await writeIssue(
      fx.dir,
      makeIssue({
        id: 1,
        title: 'Task',
        status: 'in_progress',
        assignee: 'Ada',
      }),
    );
    const result = await unclaimIssue(fx.context(), 1);
    expect(result.issue).toMatchObject({ assignee: '', status: 'todo' });
    expect(fx.commits[0]?.message).toBe('issue: unclaim #1 Task');
  });

  test('an unassigned issue is a no-op; a closed one issue_closed', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1 }));
    expect((await unclaimIssue(fx.context(), 1)).changed).toBe(false);

    await writeIssue(fx.dir, makeIssue({ id: 2, status: 'done' }), {
      closed: true,
    });
    expect((await rejection(unclaimIssue(fx.context(), 2))).code).toBe(
      'issue_closed',
    );
  });

  test('someone else’s issue needs force', async () => {
    await writeIssue(
      fx.dir,
      makeIssue({ id: 1, status: 'in_progress', assignee: 'bob@x.com' }),
    );
    const err = await rejection(unclaimIssue(fx.context(), 1));
    expect(err.code).toBe('already_claimed');
    expect(err.message).toBe('Issue #1 is claimed by bob@x.com, not you.');
    const forced = await unclaimIssue(fx.context(), 1, { force: true });
    expect(forced.issue.assignee).toBe('');
  });
});

describe('identity validation (#98)', () => {
  test('a claim comment by an identity with a line break or em dash is rejected', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Task' }));
    const before = await Bun.file(join(fx.dir, '.issues', '1-task.md')).text();
    for (const name of ['Ada\nL', 'Ada \u2014 x']) {
      const ctx = fx.context({ identity: async () => ({ name, email: '' }) });
      const claim = await rejection(claimIssue(ctx, 1, { comment: 'mine' }));
      expect(claim.code).toBe('invalid_input');
      const unclaim = await rejection(
        unclaimIssue(ctx, 1, { comment: 'yours', force: true }),
      );
      expect(unclaim.code).toBe('invalid_input');
    }
    expect(await Bun.file(join(fx.dir, '.issues', '1-task.md')).text()).toBe(
      before,
    );
    expect(fx.events).toEqual([]);
  });

  test('a claim by an identity with a line break is rejected (it is the assignee)', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Task' }));
    for (const user of [
      { name: 'Ada\nL', email: '' },
      { name: 'Ada', email: 'ada@x\n.com' },
    ]) {
      const err = await rejection(
        claimIssue(fx.context({ identity: async () => user }), 1),
      );
      expect(err.code).toBe('invalid_input');
    }
    expect((await readIssue(fx.dir, 1)).assignee).toBe('');
  });

  test('an em dash in the name is fine for a claim without a comment', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Task' }));
    const user = { name: 'Ada \u2014 L', email: '' };
    const result = await claimIssue(
      fx.context({ identity: async () => user }),
      1,
    );
    expect(result.issue.assignee).toBe('Ada \u2014 L');
  });
});

describe('superseding a claim elsewhere on a tied or later clock (#94)', () => {
  const NOW = '2026-01-02T00:00:00.000Z';
  let tmp: string;
  let wt: string;

  beforeEach(async () => {
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'gitrac-claim-skew-')));
    const git = simpleGit(fx.dir);
    await git.raw(['init', '-b', 'main']);
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    await git.addConfig('commit.gpgsign', 'false');
    await writeIssue(
      fx.dir,
      makeIssue({ id: 1, title: 'Task', status: 'todo' }),
    );
    await git.add('.');
    await git.commit('init');
    wt = join(tmp, 'wt-1');
    await git.raw(['worktree', 'add', '-b', 'agent-1', wt]);
  });

  afterEach(async () => {
    setSystemTime();
    await rm(tmp, { recursive: true, force: true });
  });

  /** Claim issue #1 in the other worktree, as `assignee`, at `updated`. */
  async function claimInWorktree(assignee: string, updated: string) {
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

  for (const [label, updated, expected] of [
    ['in the same millisecond', NOW, '2026-01-02T00:00:00.001Z'],
    [
      'from a clock ahead of ours',
      '2026-01-02T00:05:00.000Z',
      '2026-01-02T00:05:00.001Z',
    ],
  ] as const) {
    test(`unclaim releases my claim made ${label}`, async () => {
      await claimInWorktree(ADA.email, updated);
      setSystemTime(new Date(NOW));
      const result = await unclaimIssue(fx.context(), 1);
      expect(result.changed).toBe(true);
      if (!result.changed) return;
      expect(result.elsewhere?.ref).toBe('agent-1');
      expect(result.issue.updated).toBe(expected);
      expect(await effectiveClaimElsewhere()).toBeUndefined();
    });

    test(`claim --force takes over a claim made ${label}`, async () => {
      await claimInWorktree('bob@example.com', updated);
      setSystemTime(new Date(NOW));
      const result = await claimIssue(fx.context(), 1, {
        force: true,
        comment: 'taking over',
      });
      expect(result.changed).toBe(true);
      if (!result.changed) return;
      expect(result.issue.updated).toBe(expected);
      // The claim comment has the same timestamp as `updated`.
      expect(result.issue.comments.at(-1)?.timestamp).toBe(expected);
      expect(await effectiveClaimElsewhere()).toBeUndefined();
    });
  }
});

/** Regression tests for #105: hand a claimed issue off for review. */
describe('submitForReview', () => {
  async function enableReview() {
    const config = await readConfig(fx.dir);
    config.statuses.splice(3, 0, { name: 'review', closed: false });
    config.reviewStatus = 'review';
    await writeConfig(fx.dir, config);
  }

  test('without a review status it is invalid_input, before the issue is loaded', async () => {
    const err = await rejection(submitForReview(fx.context(), 99));
    expect(err.code).toBe('invalid_input');
    expect(err.message).toContain('reviewStatus');
    expect(fx.events).toEqual([]);
  });

  test('my claimed issue goes to review, keeping the assignee', async () => {
    await enableReview();
    await writeIssue(
      fx.dir,
      makeIssue({
        id: 1,
        title: 'Task',
        status: 'in_progress',
        assignee: ADA.email,
      }),
    );
    const result = await submitForReview(fx.context(), 1, {
      comment: 'ready for review',
    });
    expect(result.changed).toBe(true);
    expect(result.issue).toMatchObject({
      status: 'review',
      assignee: ADA.email,
      comments: [{ author: 'Ada', body: 'ready for review' }],
    });
    expect(result.issue.updated > '2025-01-01T00:00:00Z').toBe(true);
    expect(fx.commits[0]?.message).toBe('issue: review #1 Task');
    expect((await readIssue(fx.dir, 1)).status).toBe('review');

    // Again: a no-op.
    const again = await submitForReview(fx.context(), 1);
    expect(again.changed).toBe(false);
    expect(fx.commits).toHaveLength(1);

    // Still claimed: someone else needs force.
    const bob = { name: 'Bob', email: 'bob@x.com' };
    const err = await rejection(
      claimIssue(fx.context({ identity: async () => bob }), 1),
    );
    expect(err.code).toBe('already_claimed');
    expect(err.message).toBe(
      `Issue #1 is already claimed by ${ADA.email} (review).`,
    );
  });

  test('claim by the assignee moves it back to the active status; unclaim to the unclaim status', async () => {
    await enableReview();
    await writeIssue(
      fx.dir,
      makeIssue({ id: 1, status: 'review', assignee: ADA.email }),
    );
    const claimed = await claimIssue(fx.context(), 1);
    expect(claimed.changed).toBe(true);
    expect(claimed.issue.status).toBe('in_progress');

    await submitForReview(fx.context(), 1);
    const released = await unclaimIssue(fx.context(), 1);
    expect(released.issue).toMatchObject({ status: 'todo', assignee: '' });
  });

  test('unclaimed is invalid_state; someone else’s needs force; closed is issue_closed', async () => {
    await enableReview();
    await writeIssue(fx.dir, makeIssue({ id: 1, status: 'todo' }));
    const unclaimed = await rejection(submitForReview(fx.context(), 1));
    expect(unclaimed.code).toBe('invalid_state');
    expect(unclaimed.message).toBe(
      'Issue #1 is not claimed (todo); only a claimed issue (in_progress, assigned) can go to review.',
    );

    await writeIssue(
      fx.dir,
      makeIssue({ id: 2, status: 'in_progress', assignee: 'bob@x.com' }),
    );
    const theirs = await rejection(submitForReview(fx.context(), 2));
    expect(theirs.code).toBe('already_claimed');
    expect(theirs.message).toBe('Issue #2 is claimed by bob@x.com, not you.');
    const forced = await submitForReview(fx.context(), 2, { force: true });
    expect(forced.issue).toMatchObject({
      status: 'review',
      assignee: 'bob@x.com',
    });

    await writeIssue(fx.dir, makeIssue({ id: 3, status: 'done' }), {
      closed: true,
    });
    expect((await rejection(submitForReview(fx.context(), 3))).code).toBe(
      'issue_closed',
    );
  });
});
