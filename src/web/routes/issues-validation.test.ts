import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createDefaultConfig } from '../../core/config.ts';
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
import { issueRoutes } from './issues.ts';

/**
 * Regression tests for #41: the web API must validate every field (status,
 * priority, title, labels, types) before writing, returning 400 with a clear
 * error and leaving the files untouched.
 */

let dir: string;
let app: Hono;
let ctx: ServerContext;

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 1,
    title: 'Test Issue',
    status: 'backlog',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2025-01-01T00:00:00Z',
    createdBy: 'tester',
    updated: '2025-01-01T00:00:00Z',
    description: 'A test issue description.',
    comments: [],
    ...overrides,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-api-validation-'));
  await initIssuesDir(dir);
  const config = createDefaultConfig();
  config.git.autoCommit = false;
  ctx = {
    dir,
    config,
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(dir),
  };
  app = new Hono();
  app.route('/api', issueRoutes(ctx));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function send(
  method: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return app.request(`http://localhost/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Snapshot every file under .issues/ so we can assert nothing changed. */
async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const entries = await readdir(join(dir, '.issues'), {
    recursive: true,
    withFileTypes: true,
  });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const p = join(e.parentPath, e.name);
    out[p] = await readFile(p, 'utf-8');
  }
  return out;
}

const invalidBodies: [string, unknown][] = [
  ['unknown status', { status: 'bogus' }],
  ['non-string status', { status: 7 }],
  ['unknown priority', { priority: 'critical' }],
  ['empty title', { title: '   ' }],
  ['non-string title', { title: 123 }],
  ['non-array labels', { labels: 'bug' }],
  ['non-string label', { labels: ['bug', 5] }],
  ['empty label', { labels: [''] }],
  ['non-string assignee', { assignee: { name: 'x' } }],
  ['non-string description', { description: 42 }],
];

describe('POST /api/issues validation', () => {
  test.each(invalidBodies)('rejects %s with 400', async (_name, fields) => {
    const before = await snapshot();
    const res = await send('POST', '/issues', {
      title: 'Valid title',
      ...(fields as object),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string; errors: string[] };
    expect(data.error).toMatch(/Invalid|required/);
    expect(data.errors.length).toBeGreaterThan(0);
    // No issue written and nextId not bumped
    expect(await snapshot()).toEqual(before);
  });

  test('rejects malformed JSON with 400', async () => {
    const before = await snapshot();
    const res = await send('POST', '/issues', '{not json');
    expect(res.status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });

  test.each([
    [null],
    [[]],
    ['a string'],
    [5],
  ])('rejects non-object body %j with 400', async (body) => {
    const res = await send('POST', '/issues', JSON.stringify(body));
    expect(res.status).toBe(400);
  });

  test('error message names the allowed values', async () => {
    const res = await send('POST', '/issues', { title: 'x', status: 'bogus' });
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain('Invalid status "bogus"');
    expect(data.error).toContain('backlog, todo, in_progress, done, cancelled');
  });

  test('trims title and labels, de-duplicates labels', async () => {
    const res = await send('POST', '/issues', {
      title: '  Spaced  ',
      labels: [' bug', 'bug '],
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as Issue;
    expect(data.title).toBe('Spaced');
    expect(data.labels).toEqual(['bug']);
  });

  test('unknown labels are registered with a color', async () => {
    const res = await send('POST', '/issues', {
      title: 'x',
      labels: ['brand-new'],
    });
    expect(res.status).toBe(201);
    const config = await readConfig(dir);
    expect(config.labels['brand-new']).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('PATCH /api/issues/:id validation', () => {
  beforeEach(async () => {
    await writeIssue(dir, makeIssue({ id: 1, title: 'Original' }));
  });

  test.each(invalidBodies)('rejects %s with 400', async (_name, fields) => {
    const before = await snapshot();
    const res = await send('PATCH', '/issues/1', fields);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toMatch(/Invalid|required/);
    expect(await snapshot()).toEqual(before);
  });

  test('rejects the whole update if any field is invalid', async () => {
    const res = await send('PATCH', '/issues/1', {
      title: 'Renamed',
      status: 'bogus',
    });
    expect(res.status).toBe(400);
    const issue = await readIssue(dir, 1);
    expect(issue.title).toBe('Original');
    expect(issue.status).toBe('backlog');
  });

  test('rejects malformed JSON with 400', async () => {
    const res = await send('PATCH', '/issues/1', '{nope');
    expect(res.status).toBe(400);
  });

  test('status must be one of the configured statuses', async () => {
    ctx.config = {
      ...ctx.config,
      statuses: ['todo', 'in_progress', 'done'],
    };
    const res = await send('PATCH', '/issues/1', { status: 'backlog' });
    expect(res.status).toBe(400);
  });

  test('valid partial update still works', async () => {
    const res = await send('PATCH', '/issues/1', {
      status: 'in_progress',
      labels: ['newlabel'],
    });
    expect(res.status).toBe(200);
    const issue = await readIssue(dir, 1);
    expect(issue.status).toBe('in_progress');
    expect(issue.labels).toEqual(['newlabel']);
    expect((await readConfig(dir)).labels.newlabel).toBeDefined();
  });
});

describe('POST /api/issues/:id/comments validation', () => {
  beforeEach(async () => {
    await writeIssue(dir, makeIssue({ id: 1 }));
  });

  test('rejects a non-string author', async () => {
    const before = await snapshot();
    const res = await send('POST', '/issues/1/comments', {
      body: 'hi',
      author: 123,
    });
    expect(res.status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });

  test('rejects a malformed body with 400', async () => {
    const res = await send('POST', '/issues/1/comments', 'null');
    expect(res.status).toBe(400);
  });
});
