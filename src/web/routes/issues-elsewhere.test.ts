import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import type {
  ClaimedElsewhere,
  ClosedElsewhere,
} from '../../core/elsewhere.ts';
import type { Issue } from '../../core/types.ts';
import {
  initIssuesDir,
  readConfig,
  readIssue,
  writeIssue,
} from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import { IdentityResolver } from '../../git/identity.ts';
import { scanElsewhere } from '../../service/list.ts';
import { ElsewhereCache } from '../elsewhere-cache.ts';
import type { ServerContext } from '../server.ts';
import { createApp } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';

/**
 * Regression tests for #66: `GET /api/issues` and `GET /api/issues/:id`
 * report claims made in other worktrees / on other branches
 * (`claimedElsewhere`, as in `gitrac ls -o json`), from a briefly cached scan.
 */

type Served = Issue & {
  claimedElsewhere?: ClaimedElsewhere;
  closedElsewhere?: ClosedElsewhere;
};

let tmp: string;
let main: string;
let wt1: string;
let ctx: ServerContext;
let clock: { now: number; scans: number };

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 1,
    title: 'First',
    status: 'todo',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2026-01-01T00:00:00Z',
    createdBy: 'tester',
    updated: '2026-01-01T00:00:00Z',
    description: '',
    comments: [],
    ...overrides,
  };
}

/** Claim issue `id` in `dir`'s working tree (uncommitted), as `claim --no-commit` would. */
async function claimIn(dir: string, id: number, updated: string) {
  const issue = await readIssue(dir, id);
  await writeIssue(dir, {
    ...issue,
    status: 'in_progress',
    assignee: 'bob@example.com',
    updated,
  });
}

/** Close issue `id` in `dir`'s working tree (uncommitted), as `close --no-commit` would. */
async function closeIn(dir: string, id: number, updated: string) {
  const issue = await readIssue(dir, id);
  const open = join(dir, '.issues');
  for (const file of await readdir(open)) {
    if (file.startsWith(`${id}-`)) await rm(join(open, file));
  }
  await writeIssue(
    dir,
    { ...issue, status: 'done', updated },
    { closed: true },
  );
}

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), 'gitrac-web-elsewhere-')));
  main = join(tmp, 'main');
  await simpleGit(tmp).raw(['init', '-b', 'main', main]);
  const git = simpleGit(main);
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await initIssuesDir(main);
  await writeIssue(main, makeIssue());
  await writeIssue(main, makeIssue({ id: 2, title: 'Second' }));
  await git.add('.');
  await git.commit('init');
  wt1 = join(tmp, 'wt-1');
  await git.raw(['worktree', 'add', '-b', 'agent-1', wt1]);

  clock = { now: 1_000_000, scans: 0 };
  ctx = {
    dir: main,
    config: await readConfig(main),
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(main),
    identity: new IdentityResolver(main, { author: 'Ada' }),
  };
  ctx.elsewhere = new ElsewhereCache(main, {
    now: () => clock.now,
    generation: () => ctx.watcher.generation(),
    scan: (dir) => {
      clock.scans++;
      return scanElsewhere(dir);
    },
  });
});

afterEach(async () => {
  ctx.watcher.stop();
  await rm(tmp, { recursive: true, force: true });
});

async function get<T>(path: string): Promise<T> {
  const res = await createApp(ctx, { ui: null }).request(
    `http://localhost/api${path}`,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

const WHERE = {
  ref: 'agent-1',
  assignee: 'bob@example.com',
  updated: '2026-01-02T00:00:00.000Z',
};

describe('claimedElsewhere in the web API', () => {
  test('list and detail include a claim made in another worktree', async () => {
    await claimIn(wt1, 1, WHERE.updated);

    const list = await get<Served[]>('/issues');
    expect(list.map((i) => i.id)).toEqual([1, 2]);
    expect(list[0]?.claimedElsewhere).toEqual({ ...WHERE, worktree: wt1 });
    expect(list[0]?.status).toBe('todo'); // the local file is untouched
    expect(list[1]).not.toHaveProperty('claimedElsewhere');

    const one = await get<Served>('/issues/1');
    expect(one.claimedElsewhere).toEqual({ ...WHERE, worktree: wt1 });
    expect(await get<Served>('/issues/2')).not.toHaveProperty(
      'claimedElsewhere',
    );
    // Filters see the local state; the field is added to what matches.
    const todo = await get<Served[]>('/issues?status=todo');
    expect(todo[0]?.claimedElsewhere?.ref).toBe('agent-1');
  });

  test('a claim committed on a branch is reported without a worktree', async () => {
    await simpleGit(main).raw(['worktree', 'remove', '--force', wt1]);
    const git = simpleGit(main);
    await git.checkout(['-b', 'other']);
    await claimIn(main, 2, WHERE.updated);
    await git.add('.');
    await git.commit('claim #2');
    await git.checkout('main');

    const list = await get<Served[]>('/issues');
    expect(list[1]?.claimedElsewhere).toEqual({ ...WHERE, ref: 'other' });
  });

  test('a newer local version supersedes the claim elsewhere', async () => {
    await claimIn(wt1, 1, WHERE.updated);
    const issue = await readIssue(main, 1);
    await writeIssue(main, { ...issue, updated: '2026-01-03T00:00:00.000Z' });
    expect(await get<Served>('/issues/1')).not.toHaveProperty(
      'claimedElsewhere',
    );
  });

  test('requests within the TTL share one scan; staleness is bounded by it', async () => {
    await claimIn(wt1, 1, WHERE.updated);
    await get('/issues');
    await get('/issues');
    await get('/issues/1');
    await get('/issues/2');
    expect(clock.scans).toBe(1);

    // Released in the other worktree: not watched, so still cached...
    const released = await readIssue(wt1, 1);
    await writeIssue(wt1, {
      ...released,
      status: 'todo',
      assignee: '',
      updated: '2026-01-04T00:00:00.000Z',
    });
    expect((await get<Served>('/issues/1')).claimedElsewhere).toBeDefined();
    expect(clock.scans).toBe(1);

    // ...until the TTL passes.
    clock.now += 5000;
    expect(await get<Served>('/issues/1')).not.toHaveProperty(
      'claimedElsewhere',
    );
    expect(clock.scans).toBe(2);
  });

  test("a change to this worktree's issues invalidates the cache", async () => {
    ctx.watcher.start();
    await get('/issues');
    expect(clock.scans).toBe(1);
    await claimIn(wt1, 1, WHERE.updated);
    // Touch a local issue: the watcher sees it and the next read rescans.
    const issue = await readIssue(main, 2);
    await writeIssue(main, { ...issue, description: 'Edited.' });
    const deadline = Date.now() + 2000;
    while (ctx.watcher.generation() === 0 && Date.now() < deadline) {
      await Bun.sleep(10);
    }
    const list = await get<Served[]>('/issues');
    expect(clock.scans).toBe(2);
    expect(list[0]?.claimedElsewhere).toEqual({ ...WHERE, worktree: wt1 });
  });

  test('409 responses embed `current` with claimedElsewhere, as GET does (#77)', async () => {
    await claimIn(wt1, 1, WHERE.updated);
    const app = createApp(ctx, { ui: null });
    const send = (method: string, path: string, headers = {}) =>
      app.request(`http://localhost/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: method === 'DELETE' ? undefined : JSON.stringify({}),
      });
    const expected = await get<Served>('/issues/1');
    expect(expected.claimedElsewhere).toEqual({ ...WHERE, worktree: wt1 });

    // If-Match mismatch
    const stale = await app.request('http://localhost/api/issues/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"stale"' },
      body: JSON.stringify({ title: 'Changed' }),
    });
    expect(stale.status).toBe(409);
    const staleBody = (await stale.json()) as { current: Served };
    expect(staleBody.current).toEqual(expected);

    // If-Match mismatch on DELETE
    const del = await send('DELETE', '/issues/1', { 'If-Match': '"stale"' });
    expect(del.status).toBe(409);
    expect(((await del.json()) as { current: Served }).current).toEqual(
      expected,
    );

    // invalid_state: reopening an open issue
    const reopen = await send('PATCH', '/issues/1/reopen');
    expect(reopen.status).toBe(409);
    const reopenBody = (await reopen.json()) as {
      code: string;
      current: Served;
    };
    expect(reopenBody.code).toBe('invalid_state');
    expect(reopenBody.current).toEqual(expected);

    // An issue with no claim elsewhere has no field.
    const other = await send('PATCH', '/issues/2/reopen');
    expect(other.status).toBe(409);
    expect(
      ((await other.json()) as { current: Served }).current,
    ).not.toHaveProperty('claimedElsewhere');
  });

  test('DELETE responses embed the issue with claimedElsewhere (#77)', async () => {
    await claimIn(wt1, 1, WHERE.updated);
    const app = createApp(ctx, { ui: null });
    for (const path of ['/issues/1?dryRun=1', '/issues/1']) {
      const res = await app.request(`http://localhost/api${path}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { issue: Served };
      expect(body.issue.claimedElsewhere).toEqual({ ...WHERE, worktree: wt1 });
    }
  });

  test('the default cache is created lazily on the context', async () => {
    ctx.elsewhere = undefined;
    await claimIn(wt1, 1, WHERE.updated);
    const list = await get<Served[]>('/issues');
    expect(list[0]?.claimedElsewhere?.worktree).toBe(wt1);
    expect(ctx.elsewhere).toBeInstanceOf(ElsewhereCache);
  });
});

describe('closedElsewhere in the web API (#93)', () => {
  const CLOSED = { ref: 'agent-1', status: 'done', updated: WHERE.updated };

  test('list and detail include a close made in another worktree', async () => {
    await closeIn(wt1, 1, WHERE.updated);

    const list = await get<Served[]>('/issues');
    expect(list.map((i) => i.id)).toEqual([1, 2]);
    expect(list[0]?.closedElsewhere).toEqual({ ...CLOSED, worktree: wt1 });
    expect(list[0]).not.toHaveProperty('claimedElsewhere');
    expect(list[0]?.status).toBe('todo'); // the local file is untouched
    expect(list[1]).not.toHaveProperty('closedElsewhere');

    const one = await get<Served>('/issues/1');
    expect(one.closedElsewhere).toEqual({ ...CLOSED, worktree: wt1 });

    // Responses that embed the issue carry it too.
    const app = createApp(ctx, { ui: null });
    const plan = await app.request('http://localhost/api/issues/1?dryRun=1', {
      method: 'DELETE',
    });
    expect(plan.status).toBe(200);
    expect(((await plan.json()) as { issue: Served }).issue).toEqual(one);

    // A local write has a newer `updated`, which supersedes the close.
    const res = await app.request('http://localhost/api/issues/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as Served).not.toHaveProperty('closedElsewhere');
  });

  test('a close committed on a branch is reported without a worktree', async () => {
    await simpleGit(main).raw(['worktree', 'remove', '--force', wt1]);
    const git = simpleGit(main);
    await git.checkout(['-b', 'other']);
    await closeIn(main, 2, WHERE.updated);
    await git.add('.');
    await git.commit('close #2');
    await git.checkout('main');

    const list = await get<Served[]>('/issues');
    expect(list[1]?.closedElsewhere).toEqual({ ...CLOSED, ref: 'other' });
  });

  test('409 responses embed `current` with closedElsewhere', async () => {
    await closeIn(wt1, 1, WHERE.updated);
    const res = await createApp(ctx, { ui: null }).request(
      'http://localhost/api/issues/1/reopen',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { current: Served };
    expect(body.current.closedElsewhere).toEqual({ ...CLOSED, worktree: wt1 });
  });
});

/** Regression tests for #107: issues that exist only elsewhere. */
describe('foundElsewhere in the web API', () => {
  type Found = Served & { foundElsewhere?: { ref: string; worktree?: string } };

  test('?elsewhere=1 adds issues only in another worktree or on a branch', async () => {
    // Uncommitted in the agent's worktree.
    await writeIssue(wt1, makeIssue({ id: 3, title: 'Found a bug' }));
    // Committed on a branch not checked out anywhere.
    const git = simpleGit(main);
    await git.checkout(['-b', 'other']);
    await writeIssue(
      main,
      makeIssue({ id: 4, title: 'Sub task', labels: ['chore'] }),
    );
    // Also a newer version of #1 there: #1 is still listed once.
    await claimIn(main, 1, WHERE.updated);
    await git.add('.');
    await git.commit('create #4');
    await git.checkout('main');

    // Without the parameter: unchanged.
    expect((await get<Found[]>('/issues')).map((i) => i.id)).toEqual([1, 2]);

    const list = await get<Found[]>('/issues?elsewhere=1');
    expect(list.map((i) => [i.id, i.foundElsewhere])).toEqual([
      [1, undefined],
      [2, undefined],
      [3, { ref: 'agent-1', worktree: wt1 }],
      [4, { ref: 'other' }],
    ]);
    expect(list[0]?.claimedElsewhere?.ref).toBe('other');
    // Filters apply to them too.
    const chores = await get<Found[]>('/issues?elsewhere=1&label=chore');
    expect(chores.map((i) => i.id)).toEqual([4]);
    // One cached scan for all of it.
    expect(clock.scans).toBe(1);
  });
});
