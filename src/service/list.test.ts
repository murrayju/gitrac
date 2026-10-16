import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { parseIssueQuery } from '../core/query.ts';
import type { Config } from '../core/types.ts';
import { findIssueFile, readConfig, writeIssue } from '../fs/issue-store.ts';
import { unclaimIssue } from './claim.ts';
import { deleteIssue } from './delete.ts';
import { addComment, updateIssue } from './issues.ts';
import { linkIssue } from './links.ts';
import { listIssues } from './list.ts';
import { claimNextIssue } from './ready.ts';
import {
  ADA,
  makeIssue,
  type ServiceFixture,
  serviceFixture,
} from './test-helpers.fixture.ts';

/**
 * Regression tests for #97: a merge can leave an issue in the wrong
 * directory for its status. The status decides, not the directory.
 */

let fx: ServiceFixture;
let config: Config;

const OPEN_IN_CLOSED = join('.issues', 'closed', '1-reopened-on-a-branch.md');
const CLOSED_IN_OPEN = join('.issues', '2-closed-on-a-branch.md');

beforeEach(async () => {
  fx = await serviceFixture();
  config = await readConfig(fx.dir);
  // Open status in closed/ (one branch closed it, a later edit reopened it).
  await writeIssue(
    fx.dir,
    makeIssue({ id: 1, title: 'Reopened on a branch', status: 'todo' }),
    { closed: true },
  );
  // Closed status in .issues/ (the inverse case).
  await writeIssue(
    fx.dir,
    makeIssue({ id: 2, title: 'Closed on a branch', status: 'done' }),
  );
  await writeIssue(fx.dir, makeIssue({ id: 3, title: 'Normal open' }));
  await writeIssue(
    fx.dir,
    makeIssue({ id: 4, title: 'Normal closed', status: 'cancelled' }),
    { closed: true },
  );
});

afterEach(() => fx.cleanup());

const ids = async (raw: Record<string, string> = {}) =>
  (await listIssues(fx.dir, parseIssueQuery(raw, config), config)).issues.map(
    (i) => i.id,
  );

describe('listIssues filters by status, not directory', () => {
  test('an open issue in closed/ is listed by default', async () => {
    expect(await ids()).toEqual([1, 3]);
    expect(await ids({ status: 'todo' })).toEqual([1]);
  });

  test('a closed issue in .issues/ is listed only when asked for', async () => {
    expect(await ids({ status: 'done' })).toEqual([2]);
    expect(await ids({ status: 'all' })).toEqual([1, 2, 3, 4]);
  });

  test('reports the misplaced files', async () => {
    const listing = await listIssues(
      fx.dir,
      parseIssueQuery({}, config),
      config,
    );
    expect(listing.misplaced.sort()).toEqual(
      [CLOSED_IN_OPEN, OPEN_IN_CLOSED].sort(),
    );
    expect(listing.unreadable).toEqual([]);
  });
});

describe('the next write moves a misplaced file', () => {
  test('update', async () => {
    const result = await updateIssue(fx.context(), 1, { priority: 'high' });
    expect(result.paths).toEqual([
      join('.issues', '1-reopened-on-a-branch.md'),
      OPEN_IN_CLOSED,
    ]);
    expect(await findIssueFile(fx.dir, 1)).toMatchObject({ closed: false });
  });

  test('comment', async () => {
    const result = await addComment(fx.context(), 2, 'Noted.');
    expect(result.paths).toEqual([
      join('.issues', 'closed', '2-closed-on-a-branch.md'),
      CLOSED_IN_OPEN,
    ]);
    expect(await findIssueFile(fx.dir, 2)).toMatchObject({ closed: true });
  });

  test('link', async () => {
    await linkIssue(fx.context(), 1, { blockedBy: [3] });
    expect(await findIssueFile(fx.dir, 1)).toMatchObject({ closed: false });
  });

  test('delete of an issue it links to', async () => {
    // Still in .issues/ with a closed status, and blocked by #3.
    await writeIssue(
      fx.dir,
      makeIssue({
        id: 2,
        title: 'Closed on a branch',
        status: 'done',
        blockedBy: [3],
      }),
    );
    const result = await deleteIssue(fx.context(), 3);
    const unlinked = result.unlinked.find((u) => u.id === 2);
    expect(unlinked?.paths).toEqual([
      join('.issues', 'closed', '2-closed-on-a-branch.md'),
      CLOSED_IN_OPEN,
    ]);
    expect(await findIssueFile(fx.dir, 2)).toMatchObject({ closed: true });
  });

  test('next --claim picks and claims an open issue in closed/', async () => {
    // `ready` lists it, so the claim must not refuse it as closed.
    const result = await claimNextIssue(
      fx.context(),
      parseIssueQuery({}, config),
    );
    expect(result.issue.id).toBe(1);
    expect(result.changed).toBe(true);
    expect(await findIssueFile(fx.dir, 1)).toMatchObject({ closed: false });
  });

  test('unclaim releases an open issue in closed/', async () => {
    await writeIssue(
      fx.dir,
      makeIssue({
        id: 1,
        title: 'Reopened on a branch',
        status: 'in_progress',
        assignee: ADA.email,
      }),
      { closed: true },
    );
    const result = await unclaimIssue(fx.context(), 1);
    expect(result.changed).toBe(true);
    expect(result.issue).toMatchObject({ status: 'todo', assignee: '' });
    expect(await findIssueFile(fx.dir, 1)).toMatchObject({ closed: false });
  });

  test('then nothing is misplaced', async () => {
    await addComment(fx.context(), 1, 'Fixed.');
    await addComment(fx.context(), 2, 'Fixed.');
    expect(
      (await listIssues(fx.dir, parseIssueQuery({}, config), config)).misplaced,
    ).toEqual([]);
  });
});
