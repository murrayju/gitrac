import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createDefaultConfig } from '../../core/config.ts';
import { issueLinks } from '../../core/links.fixture.ts';
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
    makeIssue({
      id: 3,
      title: 'Task',
      links: issueLinks({ parent: 1, blockedBy: 2 }),
    }),
  );
  await writeIssue(
    dir,
    makeIssue({ id: 4, title: 'Later', links: issueLinks({ blockedBy: 3 }) }),
  );
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
  test('includes links', async () => {
    const data = (await (await req('/issues/3')).json()) as Issue;
    expect(data.links).toEqual(issueLinks({ parent: 1, blockedBy: 2 }));
  });
});

describe('GET /api/issues/:id/dependencies', () => {
  test('resolves links and derived inverses', async () => {
    const res = await req('/issues/3/dependencies');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      parent: { id: 1, title: 'Epic', status: 'todo', resolved: false },
      children: [],
      duplicateOf: null,
      duplicates: [],
      related: [],
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
    const links = [
      ...issueLinks({ blockedBy: 2 }),
      { type: 'url', url: 'https://x.dev' },
    ];
    const res = await post('/issues/1/link', { links });
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBeTruthy();
    expect(((await res.json()) as Issue).links).toEqual(links);
    expect((await readIssue(dir, 1)).links).toEqual(links);
  });

  test('400 { error, errors } for a cycle, nothing written', async () => {
    const res = await post('/issues/3/link', {
      links: issueLinks({ blockedBy: 4 }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.errors[0]).toContain('cycle');
    expect((await readIssue(dir, 3)).links).toEqual(
      issueLinks({ parent: 1, blockedBy: 2 }),
    );
    expect((await post('/issues/3/link', { blockedBy: 4 })).status).toBe(400);
  });

  test('honors If-Match', async () => {
    const res = await post(
      '/issues/1/link',
      { links: issueLinks({ blockedBy: 2 }) },
      { 'If-Match': '"stale"' },
    );
    expect(res.status).toBe(409);
    expect((await readIssue(dir, 1)).links).toBeUndefined();
  });

  test('unlinks', async () => {
    const res = await post('/issues/3/unlink', {
      links: [
        ...issueLinks({ blockedBy: 2 }),
        { type: 'issue', relationship: 'parent' },
      ],
    });
    expect(res.status).toBe(200);
    expect((await readIssue(dir, 3)).links).toBeUndefined();
    // #4 stores "blocked by #3": unlinking from #3 rewrites #4.
    const blocks = await post('/issues/3/unlink', {
      links: issueLinks({ blocks: 4 }),
    });
    expect(blocks.status).toBe(200);
    expect((await readIssue(dir, 4)).links).toBeUndefined();
  });
});

describe('GET /api/issues/:id/dependencies with a malformed issue file', () => {
  test('answers 409 invalid_issue, like GET /api/issues/:id', async () => {
    await writeFile(join(dir, '.issues', '9-bad.md'), 'no frontmatter here\n');
    const expected = {
      code: 'invalid_issue',
      file: join('.issues', '9-bad.md'),
    };
    const get = await req('/issues/9');
    expect(get.status).toBe(409);
    expect(await get.json()).toMatchObject(expected);
    const res = await req('/issues/9/dependencies');
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string };
    expect(json).toMatchObject(expected);
    expect(json.error).toContain('no YAML frontmatter');
  });
});
