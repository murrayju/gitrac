import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import simpleGit from 'simple-git';
import type { Issue } from '../../core/types.ts';
import {
  initIssuesDir,
  readConfig,
  readIssue,
  writeIssue,
} from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import type { ServerContext } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';
import { duplicateRoutes } from './duplicates.ts';
import { issueRoutes } from './issues.ts';

/** Regression tests for #126: list and resolve duplicate issue IDs. */

let dir: string;
let app: Hono;

const OLD = join('.issues', '1-old.md');
const NEW = join('.issues', '1-new.md');

function issue(title: string, created: string): Issue {
  return {
    id: 1,
    title,
    status: 'todo',
    priority: 'medium',
    assignee: '',
    labels: [],
    created,
    createdBy: 'tester',
    updated: created,
    description: '',
    comments: [],
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-web-duplicates-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await initIssuesDir(dir);
  // Two clones both created #1.
  await writeIssue(dir, issue('New', '2026-01-01T00:00:00Z'));
  await writeIssue(dir, issue('Old', '2025-01-01T00:00:00Z'));
  await git.add('.');
  await git.commit('initial');

  const ctx: ServerContext = {
    dir,
    config: await readConfig(dir),
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(dir),
  };
  app = new Hono();
  app.route('/api', duplicateRoutes(ctx));
  app.route('/api', issueRoutes(ctx));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function send(method: string, path: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(`http://localhost/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function subjects(): Promise<string[]> {
  return (await simpleGit(dir).log()).all.map((e) => e.message);
}

describe('GET /api/duplicates', () => {
  test('lists the duplicated IDs with the suggested fix', async () => {
    const res = await send('GET', '/duplicates');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject([
      {
        id: 1,
        keep: OLD,
        files: [
          { path: OLD, title: 'Old', created: '2025-01-01T00:00:00Z' },
          { path: NEW, title: 'New', created: '2026-01-01T00:00:00Z' },
        ],
        newIds: [2],
      },
    ]);
  });
});

describe('GET /api/issues', () => {
  test('gives each file its path, a unique key for a duplicated ID', async () => {
    const res = await send('GET', '/issues');
    const issues = (await res.json()) as (Issue & { path?: string })[];
    expect(issues.map((i) => [i.id, i.path]).sort()).toEqual([
      [1, NEW],
      [1, OLD],
    ]);
  });
});

describe('POST /api/duplicates/:id/resolve', () => {
  test('without keep, the oldest file keeps the ID', async () => {
    const res = await send('POST', '/duplicates/1/resolve', {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 1,
      kept: OLD,
      renumbered: [
        {
          oldId: 1,
          newId: 2,
          title: 'New',
          from: NEW,
          to: join('.issues', '2-new.md'),
          references: [],
        },
      ],
    });
    expect((await readIssue(dir, 1)).title).toBe('Old');
    expect((await readIssue(dir, 2)).title).toBe('New');
    expect((await subjects())[0]).toBe('issue: renumber #1 -> #2 New');
    expect(await (await send('GET', '/duplicates')).json()).toEqual([]);
  });

  test('keep overrides the suggestion', async () => {
    const res = await send('POST', '/duplicates/1/resolve', { keep: NEW });
    expect(res.status).toBe(200);
    expect((await readIssue(dir, 1)).title).toBe('New');
    expect((await readIssue(dir, 2)).title).toBe('Old');
  });

  test('errors map to 400 / 404 / 409', async () => {
    expect(
      (await send('POST', '/duplicates/1/resolve', { keep: 'nope.md' })).status,
    ).toBe(400);
    expect((await send('POST', '/duplicates/9/resolve', {})).status).toBe(404);
    await send('POST', '/duplicates/1/resolve', {});
    const res = await send('POST', '/duplicates/1/resolve', {});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'invalid_state' });
  });
});
