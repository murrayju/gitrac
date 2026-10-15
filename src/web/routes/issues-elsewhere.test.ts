import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import type { ClaimedElsewhere } from '../../core/elsewhere.ts';
import type { Issue } from '../../core/types.ts';
import {
  initIssuesDir,
  readConfig,
  readIssue,
  writeIssue,
} from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import { issueStatesElsewhere } from '../../git/elsewhere.ts';
import { IdentityResolver } from '../../git/identity.ts';
import { ElsewhereCache } from '../elsewhere-cache.ts';
import type { ServerContext } from '../server.ts';
import { createApp } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';

/**
 * Regression tests for #66: `GET /api/issues` and `GET /api/issues/:id`
 * report claims made in other worktrees / on other branches
 * (`claimedElsewhere`, as in `gitrac ls -o json`), from a briefly cached scan.
 */

type Served = Issue & { claimedElsewhere?: ClaimedElsewhere };

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
      return issueStatesElsewhere(dir);
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

  test('the default cache is created lazily on the context', async () => {
    ctx.elsewhere = undefined;
    await claimIn(wt1, 1, WHERE.updated);
    const list = await get<Served[]>('/issues');
    expect(list[0]?.claimedElsewhere?.worktree).toBe(wt1);
    expect(ctx.elsewhere).toBeInstanceOf(ElsewhereCache);
  });
});
