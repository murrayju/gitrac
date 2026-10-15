import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitracError } from '../core/errors.ts';
import { serializeIssue } from '../core/issue.ts';
import type { Issue } from '../core/types.ts';
import {
  findIssueFile,
  listAllIssueFiles,
  readConfig,
  readIssue,
  writeIssue,
} from '../fs/issue-store.ts';
import { claimIssue, unclaimIssue } from './claim.ts';
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
