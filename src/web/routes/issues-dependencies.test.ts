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
import type { ServerContext } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';
import { issueRoutes } from './issues.ts';

/** Regression tests for #55: dependencies in the web API. */

let dir: string;
let app: Hono;

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
  dir = await mkdtemp(join(tmpdir(), 'gitrac-deps-test-'));
  await initIssuesDir(dir);
  const config = createDefaultConfig();
  config.git.autoCommit = false;
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
  app = new Hono();
  app.route('/api', issueRoutes(ctx));

  await writeIssue(dir, makeIssue({ id: 1, title: 'Epic' }));
  await writeIssue(
    dir,
    makeIssue({ id: 2, title: 'Blocker', status: 'done' }),
    { closed: true },
  );
  await writeIssue(
    dir,
    makeIssue({ id: 3, title: 'Task', parent: 1, blockedBy: [2] }),
  );
  await writeIssue(dir, makeIssue({ id: 4, title: 'Later', blockedBy: [3] }));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function req(path: string, init?: RequestInit): Promise<Response> {
  return app.request(`http://localhost/api${path}`, init);
}

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return req(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('GET /api/issues/:id', () => {
  test('includes blockedBy and parent', async () => {
    const data = (await (await req('/issues/3')).json()) as Issue;
    expect(data.blockedBy).toEqual([2]);
    expect(data.parent).toBe(1);
  });
});

describe('GET /api/issues/:id/dependencies', () => {
  test('resolves links and derived inverses', async () => {
    const res = await req('/issues/3/dependencies');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      parent: { id: 1, title: 'Epic', status: 'todo', resolved: false },
      children: [],
      blockedBy: [{ id: 2, title: 'Blocker', status: 'done', resolved: true }],
      blocks: [{ id: 4, title: 'Later', status: 'todo', resolved: false }],
      blocked: false,
    });
    const epic = await (await req('/issues/1/dependencies')).json();
    expect(epic.children).toEqual([
      { id: 3, title: 'Task', status: 'todo', resolved: false },
    ]);
  });

  test('404 for a missing issue, 400 for a bad ID', async () => {
    expect((await req('/issues/99/dependencies')).status).toBe(404);
    expect((await req('/issues/x/dependencies')).status).toBe(400);
  });
});

describe('POST /api/issues/:id/link and /unlink', () => {
  test('links, replies with the issue and its ETag', async () => {
    const res = await post('/issues/1/link', { blockedBy: [2] });
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBeTruthy();
    expect(((await res.json()) as Issue).blockedBy).toEqual([2]);
    expect((await readIssue(dir, 1)).blockedBy).toEqual([2]);
  });

  test('400 { error, errors } for a cycle, nothing written', async () => {
    const res = await post('/issues/3/link', { blockedBy: 4 });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.errors[0]).toContain('cycle');
    expect((await readIssue(dir, 3)).blockedBy).toEqual([2]);
  });

  test('honors If-Match', async () => {
    const res = await post(
      '/issues/1/link',
      { blockedBy: 2 },
      { 'If-Match': '"stale"' },
    );
    expect(res.status).toBe(409);
    expect((await readIssue(dir, 1)).blockedBy).toBeUndefined();
  });

  test('unlinks', async () => {
    const res = await post('/issues/3/unlink', {
      blockedBy: [2],
      parent: true,
    });
    expect(res.status).toBe(200);
    const issue = await readIssue(dir, 3);
    expect(issue.blockedBy).toBeUndefined();
    expect(issue.parent).toBeUndefined();
  });
});
