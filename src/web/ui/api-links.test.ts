import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createDefaultConfig } from '../../core/config.ts';
import type { Issue } from '../../core/types.ts';
import {
  initIssuesDir,
  readIssue,
  writeConfig,
  writeIssue,
} from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import { IdentityResolver } from '../../git/identity.ts';
import { issueRoutes } from '../routes/issues.ts';
import type { ServerContext } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';
import { ApiError, fetchIssues, linkIssue, unlinkIssue } from './api.ts';
import { requestErrorReason } from './lib/upload-error.ts';

/**
 * The UI's link / list helpers against the real issue routes: `fetch` is
 * routed into an in-process Hono app.
 */

let dir: string;
const realFetch = globalThis.fetch;
const requests: { url: string; method: string; body: unknown }[] = [];

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 1,
    title: 'Test Issue',
    status: 'todo',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2025-01-01T00:00:00Z',
    createdBy: 'tester',
    updated: '2025-01-01T00:00:00Z',
    description: '',
    comments: [],
    ...overrides,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-ui-links-test-'));
  await initIssuesDir(dir);
  const config = createDefaultConfig();
  config.git.autoCommit = false;
  config.labels = { bug: '#ff0000', ui: '#00ff00' };
  await writeConfig(dir, config);
  const ctx: ServerContext = {
    dir,
    config,
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(dir),
    identity: new IdentityResolver(dir, {
      read: async () => ({ name: 'Ada', email: 'ada@example.com' }),
    }),
  };
  const app = new Hono();
  app.route('/api', issueRoutes(ctx));
  requests.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return app.request(`http://localhost${url}`, init);
  }) as typeof fetch;

  await writeIssue(dir, makeIssue({ id: 1, title: 'Epic' }));
  await writeIssue(
    dir,
    makeIssue({
      id: 2,
      title: 'Login timeout',
      labels: ['bug'],
      assignee: 'ada@example.com',
    }),
  );
  await writeIssue(
    dir,
    makeIssue({ id: 3, title: 'Polish header', labels: ['ui'] }),
  );
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
});

async function stored(id: number): Promise<Issue> {
  const issue = await readIssue(dir, id);
  if (!issue) throw new Error(`#${id} missing`);
  return issue;
}

describe('linkIssue / unlinkIssue', () => {
  test('add and remove blockers', async () => {
    const linked = await linkIssue(3, { blockedBy: [1, 2] });
    expect(linked.blockedBy).toEqual([1, 2]);
    expect(requests.at(-1)).toEqual({
      url: '/api/issues/3/link',
      method: 'POST',
      body: { blockedBy: [1, 2] },
    });
    expect((await stored(3)).blockedBy).toEqual([1, 2]);

    const unlinked = await unlinkIssue(3, { blockedBy: [1] });
    expect(unlinked.blockedBy).toEqual([2]);
    expect(requests.at(-1)?.url).toBe('/api/issues/3/unlink');
    expect((await stored(3)).blockedBy).toEqual([2]);
  });

  test('set and clear the parent', async () => {
    expect((await linkIssue(3, { parent: 1 })).parent).toBe(1);
    expect((await stored(3)).parent).toBe(1);
    const cleared = await unlinkIssue(3, { parent: true });
    expect(cleared.parent).toBeUndefined();
    expect((await stored(3)).parent).toBeUndefined();
  });

  test('a cycle is a 400 with the server message', async () => {
    await linkIssue(2, { blockedBy: [3] });
    const err = await linkIssue(3, { blockedBy: [2] }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect(requestErrorReason(err)).toBe(
      '#3 blocked by #2 would create a dependency cycle (#3 → #2 → #3)',
    );
    expect((await stored(3)).blockedBy).toBeUndefined();
  });

  test('a missing target is a 400 with the server message', async () => {
    const err = await linkIssue(3, { parent: 99 }).catch((e) => e);
    expect(requestErrorReason(err)).toBe('Issue #99 not found (parent of #3)');
  });
});

describe('fetchIssues filters', () => {
  const ids = (issues: Issue[]) => issues.map((i) => i.id);

  test('search, label and mine', async () => {
    expect(ids(await fetchIssues({ search: 'login' }))).toEqual([2]);
    expect(ids(await fetchIssues({ label: 'ui' }))).toEqual([3]);
    expect(ids(await fetchIssues({ mine: true }))).toEqual([2]);
    expect(ids(await fetchIssues({ label: 'ui', search: 'login' }))).toEqual(
      [],
    );
    expect(ids(await fetchIssues({}))).toEqual([1, 2, 3]);
  });
});
