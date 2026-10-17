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
  writeConfig,
  writeIssue,
} from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import { IdentityResolver } from '../../git/identity.ts';
import type { ServerContext } from '../server.ts';
import { createApp } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';

/**
 * Regression tests for #103: `POST /api/issues/:id/claim` and `/unclaim`
 * apply the CLI's claim rules (`claimIssue` / `unclaimIssue`), so the web UI
 * can't silently take over a claim held here or in another worktree.
 */

type Served = Issue & {
  claimedElsewhere?: ClaimedElsewhere;
  closedElsewhere?: ClosedElsewhere;
};

interface ErrorBody {
  error: string;
  code?: string;
  assignee?: string;
  status?: string;
  claimedElsewhere?: ClaimedElsewhere;
  closedElsewhere?: ClosedElsewhere;
  current?: Served;
}

const GRACE = { name: 'Grace', email: 'grace@example.com' };
const LATER = '2026-01-02T00:00:00.000Z';

let tmp: string;
let main: string;
let wt1: string;
let ctx: ServerContext;
let prefix: string;

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

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), 'gitrac-web-claim-')));
  main = join(tmp, 'main');
  await simpleGit(tmp).raw(['init', '-b', 'main', main]);
  const git = simpleGit(main);
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await initIssuesDir(main);
  const config = await readConfig(main);
  config.assignees = [GRACE];
  await writeConfig(main, config);
  prefix = config.git.commitPrefix;
  await writeIssue(main, makeIssue());
  await writeIssue(
    main,
    makeIssue({
      id: 2,
      title: 'Taken',
      status: 'in_progress',
      assignee: 'bob@example.com',
    }),
  );
  await writeIssue(
    main,
    makeIssue({ id: 3, title: 'Finished', status: 'done' }),
    { closed: true },
  );
  await git.add('.');
  await git.commit('init');
  wt1 = join(tmp, 'wt-1');
  await git.raw(['worktree', 'add', '-b', 'agent-1', wt1]);

  ctx = {
    dir: main,
    config: await readConfig(main),
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(main),
    identity: new IdentityResolver(main),
  };
});

afterEach(async () => {
  ctx.watcher.stop();
  await rm(tmp, { recursive: true, force: true });
});

function send(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    createApp(ctx, { ui: null }).request(`http://localhost/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function head(): Promise<string> {
  return (await simpleGit(main).revparse(['HEAD'])).trim();
}

/** Write `issue` to `dir`'s working tree (uncommitted), as `--no-commit` would. */
async function writeIn(dir: string, id: number, fields: Partial<Issue>) {
  const issue = await readIssue(dir, id);
  await writeIssue(dir, { ...issue, ...fields });
}

describe('POST /api/issues/:id/claim', () => {
  test('claims as the server identity, commits like the CLI, sends the ETag', async () => {
    const res = await send('/issues/1/claim', { comment: '  On it.  ' });
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBeTruthy();
    const issue = (await res.json()) as Served;
    expect(issue.status).toBe('in_progress');
    expect(issue.assignee).toBe('test@test.com');
    expect(issue.comments).toEqual([
      { author: 'Test', timestamp: issue.updated, body: 'On it.' },
    ]);
    expect(await readIssue(main, 1)).toEqual(issue);
    const git = simpleGit(main);
    expect((await git.log()).latest?.message).toBe(`${prefix} claim #1 First`);
    // The new assignee is registered, as by the CLI.
    expect((await readConfig(main)).assignees).toEqual([
      GRACE,
      { name: 'Test', email: 'test@test.com' },
    ]);
    expect((await git.status()).isClean()).toBe(true);
  });

  test('a claim already held is a 200 no-op that writes nothing', async () => {
    expect((await send('/issues/1/claim')).status).toBe(200);
    const before = await readIssue(main, 1);
    const commit = await head();
    const res = await send('/issues/1/claim', { comment: 'Again' });
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBeTruthy();
    expect((await res.json()) as Served).toEqual(before);
    expect(await readIssue(main, 1)).toEqual(before);
    expect(await head()).toBe(commit);
  });

  test("someone else's claim is 409 already_claimed; force takes it over", async () => {
    const commit = await head();
    const res = await send('/issues/2/claim');
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body).toMatchObject({
      code: 'already_claimed',
      assignee: 'bob@example.com',
    });
    expect(body.error).toContain('already claimed by bob@example.com');
    expect(body).not.toHaveProperty('claimedElsewhere');
    expect((await readIssue(main, 2)).assignee).toBe('bob@example.com');
    expect(await head()).toBe(commit);

    const forced = await send('/issues/2/claim', { force: true });
    expect(forced.status).toBe(200);
    expect(((await forced.json()) as Served).assignee).toBe('test@test.com');
  });

  test('a closed issue is 409 issue_closed; force reopens and claims it', async () => {
    const res = await send('/issues/3/claim');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'issue_closed',
      status: 'done',
    });

    const forced = await send('/issues/3/claim', { force: true });
    expect(forced.status).toBe(200);
    expect(((await forced.json()) as Served).status).toBe('in_progress');
    expect(
      (await readdir(join(main, '.issues'))).some((f) => f.startsWith('3-')),
    ).toBe(true);
  });

  test('a claim held in another worktree is 409 with claimedElsewhere', async () => {
    await writeIn(wt1, 1, {
      status: 'in_progress',
      assignee: 'bob@example.com',
      updated: LATER,
    });
    const res = await send('/issues/1/claim');
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe('already_claimed');
    expect(body.assignee).toBe('bob@example.com');
    expect(body.claimedElsewhere).toEqual({
      ref: 'agent-1',
      worktree: wt1,
      assignee: 'bob@example.com',
      status: 'in_progress',
      updated: LATER,
    });
    expect(body.error).toContain(`in worktree ${wt1}`);
    expect((await readIssue(main, 1)).assignee).toBe('');

    // Take it over: the new local claim supersedes the one elsewhere.
    const forced = await send('/issues/1/claim', { force: true });
    expect(forced.status).toBe(200);
    const issue = (await forced.json()) as Served;
    expect(issue.assignee).toBe('test@test.com');
    expect(issue).not.toHaveProperty('claimedElsewhere');
  });

  test('an issue closed in another worktree is 409 with closedElsewhere', async () => {
    await writeIn(wt1, 1, { status: 'done', updated: LATER });
    const res = await send('/issues/1/claim');
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe('issue_closed');
    expect(body.closedElsewhere).toMatchObject({
      ref: 'agent-1',
      worktree: wt1,
      status: 'done',
    });
  });

  test('author: claims as that configured assignee', async () => {
    const res = await send('/issues/1/claim', {
      author: ' Grace ',
      comment: 'Mine now',
    });
    expect(res.status).toBe(200);
    const issue = (await res.json()) as Served;
    expect(issue.assignee).toBe(GRACE.email);
    expect(issue.comments[0]?.author).toBe('Grace');
    // Grace is already registered: config.yaml is unchanged.
    expect((await readConfig(main)).assignees).toEqual([GRACE]);

    // Held by Grace: the server identity can't claim it without force...
    const other = await send('/issues/1/claim');
    expect(other.status).toBe(409);
    expect(((await other.json()) as ErrorBody).assignee).toBe(GRACE.email);
    // ...but Grace claiming again is a no-op.
    expect((await send('/issues/1/claim', { author: 'Grace' })).status).toBe(
      200,
    );
  });

  test('author: the server identity name is accepted too', async () => {
    const res = await send('/issues/1/claim', { author: 'Test' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Served).assignee).toBe('test@test.com');
  });

  test('an unknown or invalid author is 400 and writes nothing', async () => {
    const commit = await head();
    for (const author of ['Mallory', '', 'Bad \u2014 name', 42, 'a\nb']) {
      const res = await send('/issues/1/claim', { author });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error).toBeTruthy();
    }
    expect((await readIssue(main, 1)).assignee).toBe('');
    expect(await head()).toBe(commit);
  });

  test('a bad body is 400; a bad or missing ID is 400 / 404', async () => {
    expect((await send('/issues/1/claim', { force: 'yes' })).status).toBe(400);
    expect((await send('/issues/1/claim', { comment: 5 })).status).toBe(400);
    expect((await send('/issues/x/claim')).status).toBe(400);
    expect((await send('/issues/99/claim')).status).toBe(404);
    // Input errors take precedence over a missing issue.
    expect((await send('/issues/99/claim', { author: 'Mallory' })).status).toBe(
      400,
    );
  });

  test('honors If-Match', async () => {
    const stale = await send('/issues/1/claim', undefined, {
      'If-Match': '"stale"',
    });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as ErrorBody;
    expect(body.current?.id).toBe(1);
    expect((await readIssue(main, 1)).assignee).toBe('');

    const etag = stale.headers.get('ETag') ?? '';
    expect(etag).toBeTruthy();
    const res = await send('/issues/1/claim', undefined, { 'If-Match': etag });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/issues/:id/unclaim', () => {
  test('releases your claim to the unclaim status', async () => {
    await send('/issues/1/claim');
    const res = await send('/issues/1/unclaim', { comment: 'Back' });
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBeTruthy();
    const issue = (await res.json()) as Served;
    expect(issue.status).toBe('todo');
    expect(issue.assignee).toBe('');
    expect(issue.comments.at(-1)?.body).toBe('Back');
    expect(await readIssue(main, 1)).toEqual(issue);
  });

  test('an unassigned issue is a 200 no-op', async () => {
    const commit = await head();
    const res = await send('/issues/1/unclaim');
    expect(res.status).toBe(200);
    expect(((await res.json()) as Served).assignee).toBe('');
    expect(await head()).toBe(commit);
  });

  test("someone else's claim is 409 already_claimed unless force", async () => {
    const res = await send('/issues/2/unclaim');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'already_claimed',
      assignee: 'bob@example.com',
    });
    const forced = await send('/issues/2/unclaim', { force: true });
    expect(forced.status).toBe(200);
    expect(((await forced.json()) as Served).assignee).toBe('');
  });

  test('author: releases as that assignee', async () => {
    await send('/issues/1/claim', { author: 'Grace' });
    expect((await send('/issues/1/unclaim')).status).toBe(409);
    const res = await send('/issues/1/unclaim', { author: 'Grace' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Served).assignee).toBe('');
  });

  test('a closed issue is 409 issue_closed', async () => {
    const res = await send('/issues/3/unclaim');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'issue_closed',
      status: 'done',
    });
  });

  test('a claim held in another worktree is 409 with claimedElsewhere; force releases it', async () => {
    await writeIn(wt1, 1, {
      status: 'in_progress',
      assignee: 'bob@example.com',
      updated: LATER,
    });
    const res = await send('/issues/1/unclaim');
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe('already_claimed');
    expect(body.claimedElsewhere?.worktree).toBe(wt1);

    const forced = await send('/issues/1/unclaim', { force: true });
    expect(forced.status).toBe(200);
    const issue = (await forced.json()) as Served;
    expect(issue.assignee).toBe('');
    expect(issue).not.toHaveProperty('claimedElsewhere');
  });

  test('honors If-Match', async () => {
    await send('/issues/1/claim');
    const res = await send('/issues/1/unclaim', undefined, {
      'If-Match': '"stale"',
    });
    expect(res.status).toBe(409);
    expect((await readIssue(main, 1)).assignee).toBe('test@test.com');
  });
});

/**
 * Regression tests for #111: `renew` on claim, `stale` on unclaim, and
 * `staleClaim` in issue responses when `staleAfter` is configured.
 */
describe('stale claims and renew (#111)', () => {
  type WithStale = Served & {
    staleClaim?: {
      assignee: string;
      updated: string;
      ref?: string;
      worktree?: string;
    };
  };

  async function setStaleAfter(value: string | undefined) {
    const config = await readConfig(main);
    if (value === undefined) delete config.staleAfter;
    else config.staleAfter = value;
    await writeConfig(main, config);
  }

  async function get<T>(path: string): Promise<T> {
    const res = await createApp(ctx, { ui: null }).request(
      `http://localhost/api${path}`,
    );
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  }

  test('claim with renew: a heartbeat on your own claim', async () => {
    const first = (await (await send('/issues/1/claim')).json()) as Served;
    const res = await send('/issues/1/claim', { renew: true });
    expect(res.status).toBe(200);
    const renewed = (await res.json()) as Served;
    expect(renewed.assignee).toBe('test@test.com');
    expect(renewed.status).toBe('in_progress');
    expect(Date.parse(renewed.updated)).toBeGreaterThan(
      Date.parse(first.updated),
    );
    expect(await readIssue(main, 1)).toEqual(renewed);
    expect((await simpleGit(main).status()).isClean()).toBe(true);
    // renew does not take over someone else's claim.
    const theirs = await send('/issues/2/claim', { renew: true });
    expect(theirs.status).toBe(409);
    expect(((await theirs.json()) as ErrorBody).code).toBe('already_claimed');
  });

  test('a bad renew or stale is 400 and writes nothing', async () => {
    const commit = await head();
    expect((await send('/issues/1/claim', { renew: 'yes' })).status).toBe(400);
    for (const stale of ['2 hours', '0h', 5, true]) {
      const res = await send('/issues/2/unclaim', { stale });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error).toBeTruthy();
    }
    expect((await readIssue(main, 2)).assignee).toBe('bob@example.com');
    expect(await head()).toBe(commit);
  });

  test("unclaim with stale releases someone else's stale claim, not a fresh one", async () => {
    // Issue 2 (Bob) has had no activity since 2026-01-01.
    const res = await send('/issues/2/unclaim', { stale: '2h' });
    expect(res.status).toBe(200);
    const issue = (await res.json()) as Served;
    expect(issue.assignee).toBe('');
    expect(issue.status).toBe('todo');

    // A fresh claim by Grace: 409 with the claim's age; nothing written.
    await send('/issues/1/claim', { author: 'Grace' });
    const commit = await head();
    const fresh = await send('/issues/1/unclaim', { stale: '2h' });
    expect(fresh.status).toBe(409);
    const body = (await fresh.json()) as ErrorBody;
    expect(body.code).toBe('already_claimed');
    expect(body.assignee).toBe(GRACE.email);
    expect(body.error).toContain('less than 2h');
    expect((await readIssue(main, 1)).assignee).toBe(GRACE.email);
    expect(await head()).toBe(commit);
  });

  test('staleClaim is served only when staleAfter is configured', async () => {
    const plain = await get<WithStale>('/issues/2');
    expect(plain).not.toHaveProperty('staleClaim');

    await setStaleAfter('2h');
    const one = await get<WithStale>('/issues/2');
    expect(one.staleClaim).toEqual({
      assignee: 'bob@example.com',
      updated: '2026-01-01T00:00:00Z',
    });
    const list = await get<WithStale[]>('/issues');
    expect(list.find((i) => i.id === 2)?.staleClaim).toEqual(one.staleClaim);
    // Not claimed, or closed: no mark.
    expect(list.find((i) => i.id === 1)).not.toHaveProperty('staleClaim');
    // A threshold longer than the claim's age: no mark.
    await setStaleAfter('100000d');
    expect(await get<WithStale>('/issues/2')).not.toHaveProperty('staleClaim');
  });

  test('staleClaim says where a stale claim elsewhere is; 409 current has it too', async () => {
    await setStaleAfter('2h');
    await writeIn(wt1, 1, {
      status: 'in_progress',
      assignee: 'bob@example.com',
      updated: LATER,
    });
    const one = await get<WithStale>('/issues/1');
    expect(one.claimedElsewhere?.status).toBe('in_progress');
    expect(one.staleClaim).toEqual({
      assignee: 'bob@example.com',
      updated: LATER,
      ref: 'agent-1',
      worktree: wt1,
    });

    // A changed version (If-Match) embeds `current` as GET serves it.
    const res = await send('/issues/2/claim', undefined, {
      'If-Match': '"old"',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { current?: WithStale };
    expect(body.current?.staleClaim?.assignee).toBe('bob@example.com');

    // Releasing the stale claim elsewhere clears both marks.
    const released = await send('/issues/1/unclaim', { stale: '2h' });
    expect(released.status).toBe(200);
    const issue = (await released.json()) as WithStale;
    expect(issue.assignee).toBe('');
    expect(issue).not.toHaveProperty('claimedElsewhere');
    expect(issue).not.toHaveProperty('staleClaim');
  });

  test('a claim in the review status elsewhere carries that status', async () => {
    const config = await readConfig(main);
    config.statuses.splice(3, 0, { name: 'review', closed: false });
    config.reviewStatus = 'review';
    config.staleAfter = '2h';
    await writeConfig(main, config);
    await writeIn(wt1, 1, {
      status: 'review',
      assignee: 'bob@example.com',
      updated: LATER,
    });
    const one = await get<WithStale>('/issues/1');
    expect(one.claimedElsewhere).toEqual({
      ref: 'agent-1',
      worktree: wt1,
      assignee: 'bob@example.com',
      status: 'review',
      updated: LATER,
    });
    // A claim in review waits on the reviewer: never stale.
    expect(one).not.toHaveProperty('staleClaim');
  });
});
