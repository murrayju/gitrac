import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitracError } from '../core/errors.ts';
import { parseIssueQuery } from '../core/query.ts';
import { findIssueFile, readConfig, writeIssue } from '../fs/issue-store.ts';
import { claimIssue, unclaimIssue } from './claim.ts';
import { closeIssue, createIssue, reopenIssue, updateIssue } from './issues.ts';
import { listIssues } from './list.ts';
import { claimNextIssue } from './ready.ts';
import {
  makeIssue,
  type ServiceFixture,
  serviceFixture,
} from './test-helpers.fixture.ts';

/**
 * Regression tests for #57: statuses and priorities (and the statuses claim,
 * unclaim and close use) come from config.yaml, not hard-coded names.
 */

const CUSTOM = `version: 1
statuses:
  - open
  - name: doing
    label: Doing
    color: '#d4a843'
    closed: false
  - review
  - name: resolved
    closed: true
  - name: wontfix
    label: Won't fix
    closed: true
labels: {}
priorities:
  - p0
  - p1
  - p2
defaultStatus: open
defaultPriority: p1
activeStatus: doing
unclaimStatus: review
closeStatus: resolved
cancelStatus: wontfix
git:
  autoCommit: true
  autoPush: false
  commitPrefix: 'issue:'
  defaultBranch: main
assignees: []
`;

let fx: ServiceFixture;
const configPath = () => join(fx.dir, '.issues', 'config.yaml');

beforeEach(async () => {
  fx = await serviceFixture();
  await writeFile(configPath(), CUSTOM);
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

/** Every file under .issues/ with its content. */
async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const sub of ['', 'closed']) {
    const dir = join(fx.dir, '.issues', sub);
    for (const name of await readdir(dir)) {
      if (name === 'closed') continue;
      out[join(sub, name)] = await readFile(join(dir, name), 'utf-8');
    }
  }
  return out;
}

async function where(id: number): Promise<'open' | 'closed' | null> {
  const found = await findIssueFile(fx.dir, id);
  if (!found) return null;
  return found.closed ? 'closed' : 'open';
}

describe('custom statuses and priorities (#57)', () => {
  test('create uses the configured defaults and rejects built-in names', async () => {
    const created = await createIssue(fx.context(), { title: 'A' });
    expect(created.issue).toMatchObject({ status: 'open', priority: 'p1' });

    const before = await snapshot();
    const err = await rejection(
      createIssue(fx.context(), { title: 'B', status: 'backlog' }),
    );
    expect(err.code).toBe('invalid_input');
    expect(err.message).toContain(
      'must be one of open, doing, review, resolved, wontfix',
    );
    const bad = await rejection(
      createIssue(fx.context(), { title: 'B', priority: 'urgent' }),
    );
    expect(bad.message).toContain('must be one of p0, p1, p2');
    expect(await snapshot()).toEqual(before);
  });

  test('create with a configured closed status writes into closed/ (#67)', async () => {
    const done = await createIssue(fx.context(), {
      title: 'A',
      status: 'wontfix',
    });
    expect(done.paths).toEqual([join('.issues', 'closed', '1-a.md')]);
    expect(await where(1)).toBe('closed');
    // A non-closed custom status stays open.
    await createIssue(fx.context(), { title: 'B', status: 'review' });
    expect(await where(2)).toBe('open');
  });

  test('claim sets the active status; unclaim moves it to the unclaim status', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, status: 'open' }));
    const claimed = await claimIssue(fx.context(), 1);
    expect(claimed.issue.status).toBe('doing');

    const other = fx.context({
      identity: async () => ({ name: 'Bob', email: 'bob@example.com' }),
    });
    const err = await rejection(claimIssue(other, 1));
    expect(err.code).toBe('already_claimed');
    expect(err.message).toContain('(doing)');

    const released = await unclaimIssue(fx.context(), 1);
    expect(released.issue).toMatchObject({ status: 'review', assignee: '' });
  });

  test('an issue in a built-in-named status is not "claimed" under a custom active status', async () => {
    // `in_progress` isn't configured here: it doesn't make the issue claimed.
    await writeIssue(
      fx.dir,
      makeIssue({ id: 1, status: 'in_progress', assignee: 'bob@example.com' }),
    );
    const claimed = await claimIssue(fx.context(), 1);
    expect(claimed.issue.status).toBe('doing');
  });

  test('close uses closeStatus, --cancelled the cancelStatus, or a given closed status', async () => {
    for (const id of [1, 2, 3]) {
      await writeIssue(
        fx.dir,
        makeIssue({ id, title: `T${id}`, status: 'open' }),
      );
    }
    expect((await closeIssue(fx.context(), 1)).issue.status).toBe('resolved');
    expect(
      (await closeIssue(fx.context(), 2, { cancelled: true })).issue.status,
    ).toBe('wontfix');
    expect(
      (await closeIssue(fx.context(), 3, { status: 'wontfix' })).issue.status,
    ).toBe('wontfix');
    for (const id of [1, 2, 3]) expect(await where(id)).toBe('closed');

    // A closed custom status is "already closed".
    const err = await rejection(closeIssue(fx.context(), 1));
    expect(err.code).toBe('invalid_state');

    // Reopen goes back to the default (open) status.
    const reopened = await reopenIssue(fx.context(), 1);
    expect(reopened.issue.status).toBe('open');
    expect(await where(1)).toBe('open');
  });

  test('close rejects open/unknown statuses and status + cancelled, writing nothing', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, status: 'open' }));
    const before = await snapshot();
    for (const options of [
      { status: 'open' },
      { status: 'done' },
      { status: 'resolved', cancelled: true },
    ]) {
      const err = await rejection(closeIssue(fx.context(), 1, options));
      expect(err.code).toBe('invalid_input');
    }
    expect(await snapshot()).toEqual(before);
  });

  test('close --cancelled without a cancel status is a clear invalid_input', async () => {
    await writeFile(
      configPath(),
      CUSTOM.replace('cancelStatus: wontfix\n', ''),
    );
    await writeIssue(fx.dir, makeIssue({ id: 1, status: 'open' }));
    const before = await snapshot();
    const err = await rejection(
      closeIssue(fx.context(), 1, { cancelled: true }),
    );
    expect(err.code).toBe('invalid_input');
    expect(err.message).toContain('No cancel status is configured');
    expect(await snapshot()).toEqual(before);
  });

  test('setting a custom closed status moves the issue to closed/', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, status: 'open' }));
    await updateIssue(fx.context(), 1, { status: 'wontfix' });
    expect(await where(1)).toBe('closed');
    await updateIssue(fx.context(), 1, { status: 'review' });
    expect(await where(1)).toBe('open');
  });

  test('ls hides custom closed statuses and sorts by the configured orders', async () => {
    const config = await readConfig(fx.dir);
    await writeIssue(
      fx.dir,
      makeIssue({ id: 1, status: 'open', priority: 'p2' }),
    );
    await writeIssue(
      fx.dir,
      makeIssue({ id: 2, title: 'Two', status: 'review', priority: 'p0' }),
    );
    await writeIssue(
      fx.dir,
      makeIssue({ id: 3, title: 'Three', status: 'doing', priority: 'p1' }),
    );
    await writeIssue(
      fx.dir,
      makeIssue({ id: 4, title: 'Four', status: 'wontfix' }),
      { closed: true },
    );
    const list = async (raw: Record<string, string>) =>
      (
        await listIssues(fx.dir, parseIssueQuery(raw, config), config)
      ).issues.map((i) => i.id);
    expect(await list({})).toEqual([1, 2, 3]);
    expect(await list({ status: 'wontfix' })).toEqual([4]);
    expect(await list({ status: 'all', sort: 'status' })).toEqual([2, 3, 1, 4]);
    expect(await list({ sort: 'priority' })).toEqual([2, 3, 1]);
  });

  test('next --claim skips issues in the custom active status', async () => {
    const config = await readConfig(fx.dir);
    await writeIssue(
      fx.dir,
      makeIssue({
        id: 1,
        status: 'doing',
        priority: 'p0',
        assignee: 'ada@example.com',
      }),
    );
    await writeIssue(
      fx.dir,
      makeIssue({ id: 2, title: 'Two', status: 'open', priority: 'p2' }),
    );
    const query = parseIssueQuery({ sort: 'priority' }, config);
    const result = await claimNextIssue(fx.context(), query);
    expect(result.issue).toMatchObject({ id: 2, status: 'doing' });
  });
});

describe('config.yaml format (#57)', () => {
  test('reading never rewrites; a write keeps plain lists and definitions as they are', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, status: 'open' }));
    await updateIssue(fx.context(), 1, { title: 'Renamed' });
    expect(await readFile(configPath(), 'utf-8')).toBe(CUSTOM);

    // Registering a label rewrites config.yaml, statuses unchanged.
    await updateIssue(fx.context(), 1, { labels: ['new'] });
    const written = await readFile(configPath(), 'utf-8');
    expect(written).toBe(
      CUSTOM.replace('labels: {}\n', `labels:\n  new: '#e05d5d'\n`),
    );
  });

  test('a plain-list config stays a plain list when written for another reason', async () => {
    const legacy = `version: 1
statuses:
  - backlog
  - todo
  - in_progress
  - review
  - done
  - cancelled
labels: {}
priorities:
  - high
  - low
defaultStatus: backlog
defaultPriority: low
`;
    await writeFile(configPath(), legacy);
    await writeIssue(fx.dir, makeIssue({ id: 1, priority: 'low' }));
    // Unknown legacy names (review) are open; done/cancelled closed.
    await updateIssue(fx.context(), 1, { status: 'review', labels: ['x'] });
    expect(await where(1)).toBe('open');
    const written = await readFile(configPath(), 'utf-8');
    expect(written).toContain(
      'statuses:\n  - backlog\n  - todo\n  - in_progress\n  - review\n  - done\n  - cancelled\n',
    );
    expect(written).toContain('priorities:\n  - high\n  - low\n');
    expect(written).not.toContain('closed:');
  });
});
