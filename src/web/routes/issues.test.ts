import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultConfig } from '../../core/config.ts';
import type { Issue } from '../../core/types.ts';
import { initIssuesDir, writeIssue } from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import type { ServerContext } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';
import { issueRoutes } from './issues.ts';

import { Hono } from 'hono';

let dir: string;
let app: Hono;

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
  dir = await mkdtemp(join(tmpdir(), 'gitrac-api-test-'));
  await initIssuesDir(dir);

  const config = createDefaultConfig();
  // Disable auto-commit for tests (no git repo)
  config.git.autoCommit = false;

  const ctx: ServerContext = {
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

async function req(path: string, init?: RequestInit): Promise<Response> {
  return app.request(`http://localhost/api${path}`, init);
}

describe('GET /api/issues', () => {
  test('returns empty array when no issues', async () => {
    const res = await req('/issues');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  test('returns open issues by default', async () => {
    await writeIssue(dir, makeIssue({ id: 1, title: 'Open One' }));
    await writeIssue(dir, makeIssue({ id: 2, title: 'Open Two' }));

    const res = await req('/issues');
    expect(res.status).toBe(200);
    const data = (await res.json()) as Issue[];
    expect(data).toHaveLength(2);
  });

  test('filters by assignee', async () => {
    await writeIssue(
      dir,
      makeIssue({ id: 1, title: 'Alice Task', assignee: 'alice' }),
    );
    await writeIssue(
      dir,
      makeIssue({ id: 2, title: 'Bob Task', assignee: 'bob' }),
    );

    const res = await req('/issues?assignee=alice');
    const data = (await res.json()) as Issue[];
    expect(data).toHaveLength(1);
    expect(data[0]?.assignee).toBe('alice');
  });

  test('filters by label', async () => {
    await writeIssue(
      dir,
      makeIssue({ id: 1, title: 'Bug', labels: ['bug'] }),
    );
    await writeIssue(
      dir,
      makeIssue({ id: 2, title: 'Feature', labels: ['feature'] }),
    );

    const res = await req('/issues?label=bug');
    const data = (await res.json()) as Issue[];
    expect(data).toHaveLength(1);
    expect(data[0]?.labels).toContain('bug');
  });

  test('filters by priority', async () => {
    await writeIssue(
      dir,
      makeIssue({ id: 1, title: 'Urgent', priority: 'urgent' }),
    );
    await writeIssue(
      dir,
      makeIssue({ id: 2, title: 'Low', priority: 'low' }),
    );

    const res = await req('/issues?priority=urgent');
    const data = (await res.json()) as Issue[];
    expect(data).toHaveLength(1);
    expect(data[0]?.priority).toBe('urgent');
  });

  test('sorts by priority', async () => {
    await writeIssue(
      dir,
      makeIssue({ id: 1, title: 'Low', priority: 'low' }),
    );
    await writeIssue(
      dir,
      makeIssue({ id: 2, title: 'Urgent', priority: 'urgent' }),
    );

    const res = await req('/issues?sort=priority');
    const data = (await res.json()) as Issue[];
    expect(data).toHaveLength(2);
    expect(data[0]?.priority).toBe('urgent');
    expect(data[1]?.priority).toBe('low');
  });

  test('sorts by id', async () => {
    await writeIssue(dir, makeIssue({ id: 3, title: 'Third' }));
    await writeIssue(dir, makeIssue({ id: 1, title: 'First' }));

    const res = await req('/issues?sort=id');
    const data = (await res.json()) as Issue[];
    expect(data[0]?.id).toBe(1);
    expect(data[1]?.id).toBe(3);
  });
});

describe('GET /api/issues/:id', () => {
  test('returns issue by id', async () => {
    await writeIssue(dir, makeIssue({ id: 1, title: 'Test' }));

    const res = await req('/issues/1');
    expect(res.status).toBe(200);
    const data = (await res.json()) as Issue;
    expect(data.id).toBe(1);
    expect(data.title).toBe('Test');
  });

  test('returns 404 for non-existent issue', async () => {
    const res = await req('/issues/999');
    expect(res.status).toBe(404);
  });

  test('returns 400 for invalid id', async () => {
    const res = await req('/issues/abc');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/issues', () => {
  test('creates a new issue', async () => {
    const res = await req('/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Issue' }),
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as Issue;
    expect(data.id).toBe(1);
    expect(data.title).toBe('New Issue');
    expect(data.status).toBe('backlog');
    expect(data.priority).toBe('medium');
  });

  test('creates issue with all fields', async () => {
    const res = await req('/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Full Issue',
        priority: 'high',
        labels: ['bug'],
        assignee: 'alice',
        status: 'todo',
        description: 'Some description',
      }),
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as Issue;
    expect(data.priority).toBe('high');
    expect(data.labels).toEqual(['bug']);
    expect(data.assignee).toBe('alice');
    expect(data.status).toBe('todo');
    expect(data.description).toBe('Some description');
  });

  test('returns 400 when title is missing', async () => {
    const res = await req('/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  test('returns 400 when title is empty string', async () => {
    const res = await req('/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '  ' }),
    });

    expect(res.status).toBe(400);
  });

  test('increments issue IDs', async () => {
    const res1 = await req('/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'First' }),
    });
    const res2 = await req('/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Second' }),
    });

    const data1 = (await res1.json()) as Issue;
    const data2 = (await res2.json()) as Issue;
    expect(data1.id).toBe(1);
    expect(data2.id).toBe(2);
  });
});

describe('PATCH /api/issues/:id', () => {
  test('updates issue fields', async () => {
    await writeIssue(dir, makeIssue({ id: 1, title: 'Original' }));

    const res = await req('/issues/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated', priority: 'high' }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as Issue;
    expect(data.title).toBe('Updated');
    expect(data.priority).toBe('high');
  });

  test('returns 404 for non-existent issue', async () => {
    const res = await req('/issues/999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X' }),
    });

    expect(res.status).toBe(404);
  });

  test('preserves unmodified fields', async () => {
    await writeIssue(
      dir,
      makeIssue({
        id: 1,
        title: 'Original',
        assignee: 'alice',
        labels: ['bug'],
      }),
    );

    const res = await req('/issues/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 'high' }),
    });

    const data = (await res.json()) as Issue;
    expect(data.title).toBe('Original');
    expect(data.assignee).toBe('alice');
    expect(data.labels).toEqual(['bug']);
    expect(data.priority).toBe('high');
  });
});

describe('POST /api/issues/:id/comments', () => {
  test('adds a comment', async () => {
    await writeIssue(dir, makeIssue({ id: 1, title: 'Issue' }));

    const res = await req('/issues/1/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'A comment', author: 'alice' }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as Issue;
    expect(data.comments).toHaveLength(1);
    expect(data.comments[0]?.body).toBe('A comment');
    expect(data.comments[0]?.author).toBe('alice');
  });

  test('defaults author to web', async () => {
    await writeIssue(dir, makeIssue({ id: 1, title: 'Issue' }));

    const res = await req('/issues/1/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'A comment' }),
    });

    const data = (await res.json()) as Issue;
    expect(data.comments[0]?.author).toBe('web');
  });

  test('returns 400 when body is missing', async () => {
    await writeIssue(dir, makeIssue({ id: 1, title: 'Issue' }));

    const res = await req('/issues/1/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  test('returns 404 for non-existent issue', async () => {
    const res = await req('/issues/999/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'A comment' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/issues/:id/close', () => {
  test('closes an open issue', async () => {
    await writeIssue(dir, makeIssue({ id: 1, title: 'Open Issue' }));

    const res = await req('/issues/1/close', { method: 'PATCH' });

    expect(res.status).toBe(200);
    const data = (await res.json()) as Issue;
    expect(data.status).toBe('done');
  });

  test('returns 404 for non-existent issue', async () => {
    const res = await req('/issues/999/close', { method: 'PATCH' });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/issues/:id/reopen', () => {
  test('reopens a closed issue', async () => {
    await writeIssue(dir, makeIssue({ id: 1, title: 'Issue' }));
    // Close it first
    await req('/issues/1/close', { method: 'PATCH' });

    const res = await req('/issues/1/reopen', { method: 'PATCH' });

    expect(res.status).toBe(200);
    const data = (await res.json()) as Issue;
    expect(data.status).toBe('backlog');
  });

  test('returns 404 for non-existent issue', async () => {
    const res = await req('/issues/999/reopen', { method: 'PATCH' });
    expect(res.status).toBe(404);
  });
});
