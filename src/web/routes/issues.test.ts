import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createDefaultConfig } from '../../core/config.ts';
import type { Issue } from '../../core/types.ts';
import {
  initIssuesDir,
  listClosedIssueFiles,
  listIssueFiles,
  writeIssue,
} from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import type { ServerContext } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';
import { issueRoutes } from './issues.ts';

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
    await writeIssue(dir, makeIssue({ id: 1, title: 'Bug', labels: ['bug'] }));
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
    await writeIssue(dir, makeIssue({ id: 2, title: 'Low', priority: 'low' }));

    const res = await req('/issues?priority=urgent');
    const data = (await res.json()) as Issue[];
    expect(data).toHaveLength(1);
    expect(data[0]?.priority).toBe('urgent');
  });

  test('sorts by priority', async () => {
    await writeIssue(dir, makeIssue({ id: 1, title: 'Low', priority: 'low' }));
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

describe('PATCH /api/issues/:id — closed issue handling', () => {
  test('updating a closed issue does not create a duplicate', async () => {
    // Create and close an issue
    await writeIssue(dir, makeIssue({ id: 1, title: 'Bug Fix' }));
    await req('/issues/1/close', { method: 'PATCH' });

    // Verify it's only in closed dir
    let openFiles = await listIssueFiles(dir);
    let closedFiles = await listClosedIssueFiles(dir);
    expect(openFiles).toHaveLength(0);
    expect(closedFiles).toHaveLength(1);

    // Update the closed issue (e.g. change priority)
    const res = await req('/issues/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 'high' }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as Issue;
    expect(data.priority).toBe('high');
    expect(data.status).toBe('done');

    // Verify no duplicate: still only in closed dir
    openFiles = await listIssueFiles(dir);
    closedFiles = await listClosedIssueFiles(dir);
    expect(openFiles).toHaveLength(0);
    expect(closedFiles).toHaveLength(1);
  });

  test('title rename on a closed issue writes to correct directory and cleans up old file', async () => {
    await writeIssue(dir, makeIssue({ id: 1, title: 'Old Title' }));
    await req('/issues/1/close', { method: 'PATCH' });

    // Rename the title
    const res = await req('/issues/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Title' }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as Issue;
    expect(data.title).toBe('New Title');

    // Verify: new file in closed, old file gone, nothing in open
    const openFiles = await listIssueFiles(dir);
    const closedFiles = await listClosedIssueFiles(dir);
    expect(openFiles).toHaveLength(0);
    expect(closedFiles).toContain('1-new-title.md');
    expect(closedFiles).not.toContain('1-old-title.md');
    expect(closedFiles).toHaveLength(1);
  });

  test('title rename on an open issue cleans up old file', async () => {
    await writeIssue(dir, makeIssue({ id: 1, title: 'Old Title' }));

    const res = await req('/issues/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Title' }),
    });

    expect(res.status).toBe(200);

    const openFiles = await listIssueFiles(dir);
    expect(openFiles).toContain('1-new-title.md');
    expect(openFiles).not.toContain('1-old-title.md');
    expect(openFiles).toHaveLength(1);
  });

  test('changing status from done to open moves issue out of closed dir', async () => {
    await writeIssue(dir, makeIssue({ id: 1, title: 'Issue' }));
    await req('/issues/1/close', { method: 'PATCH' });

    // Change status back to in_progress via PATCH
    const res = await req('/issues/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });

    expect(res.status).toBe(200);

    const openFiles = await listIssueFiles(dir);
    const closedFiles = await listClosedIssueFiles(dir);
    expect(openFiles).toContain('1-issue.md');
    expect(closedFiles).toHaveLength(0);
  });
});

describe('PUT /api/issues/:id/comments/:commentIndex', () => {
  test('edits a comment', async () => {
    await writeIssue(
      dir,
      makeIssue({
        id: 1,
        title: 'Issue',
        comments: [
          { author: 'alice', timestamp: '2025-01-01T00:00:00Z', body: 'Old' },
        ],
      }),
    );

    const res = await req('/issues/1/comments/0', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Updated body' }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as Issue;
    expect(data.comments).toHaveLength(1);
    expect(data.comments[0]?.body).toBe('Updated body');
    expect(data.comments[0]?.author).toBe('alice');
  });

  test('returns 404 for out-of-bounds index', async () => {
    await writeIssue(
      dir,
      makeIssue({
        id: 1,
        title: 'Issue',
        comments: [
          { author: 'alice', timestamp: '2025-01-01T00:00:00Z', body: 'Hi' },
        ],
      }),
    );

    const res = await req('/issues/1/comments/5', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Nope' }),
    });

    expect(res.status).toBe(404);
  });

  test('returns 400 for invalid index', async () => {
    await writeIssue(dir, makeIssue({ id: 1, title: 'Issue' }));

    const res = await req('/issues/1/comments/abc', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Nope' }),
    });

    expect(res.status).toBe(400);
  });

  test('returns 400 when body is missing', async () => {
    await writeIssue(
      dir,
      makeIssue({
        id: 1,
        title: 'Issue',
        comments: [
          { author: 'alice', timestamp: '2025-01-01T00:00:00Z', body: 'Hi' },
        ],
      }),
    );

    const res = await req('/issues/1/comments/0', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  test('returns 404 for non-existent issue', async () => {
    const res = await req('/issues/999/comments/0', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Nope' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/issues/:id/comments/:commentIndex', () => {
  test('deletes a comment', async () => {
    await writeIssue(
      dir,
      makeIssue({
        id: 1,
        title: 'Issue',
        comments: [
          { author: 'alice', timestamp: '2025-01-01T00:00:00Z', body: 'First' },
          { author: 'bob', timestamp: '2025-01-01T01:00:00Z', body: 'Second' },
        ],
      }),
    );

    const res = await req('/issues/1/comments/0', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as Issue;
    expect(data.comments).toHaveLength(1);
    expect(data.comments[0]?.body).toBe('Second');
    expect(data.comments[0]?.author).toBe('bob');
  });

  test('returns 404 for out-of-bounds index', async () => {
    await writeIssue(
      dir,
      makeIssue({
        id: 1,
        title: 'Issue',
        comments: [
          { author: 'alice', timestamp: '2025-01-01T00:00:00Z', body: 'Hi' },
        ],
      }),
    );

    const res = await req('/issues/1/comments/5', {
      method: 'DELETE',
    });

    expect(res.status).toBe(404);
  });

  test('returns 400 for invalid index', async () => {
    await writeIssue(dir, makeIssue({ id: 1, title: 'Issue' }));

    const res = await req('/issues/1/comments/abc', {
      method: 'DELETE',
    });

    expect(res.status).toBe(400);
  });

  test('returns 404 for non-existent issue', async () => {
    const res = await req('/issues/999/comments/0', {
      method: 'DELETE',
    });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/issues/:id/comments — closed issue handling', () => {
  test('adding a comment to a closed issue does not create a duplicate', async () => {
    // Create and close an issue
    await writeIssue(dir, makeIssue({ id: 1, title: 'Closed Bug' }));
    await req('/issues/1/close', { method: 'PATCH' });

    // Verify it's only in closed dir
    let openFiles = await listIssueFiles(dir);
    let closedFiles = await listClosedIssueFiles(dir);
    expect(openFiles).toHaveLength(0);
    expect(closedFiles).toHaveLength(1);

    // Add a comment to the closed issue
    const res = await req('/issues/1/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Follow-up note', author: 'alice' }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as Issue;
    expect(data.comments).toHaveLength(1);
    expect(data.comments[0]?.body).toBe('Follow-up note');

    // Verify no duplicate: still only in closed dir
    openFiles = await listIssueFiles(dir);
    closedFiles = await listClosedIssueFiles(dir);
    expect(openFiles).toHaveLength(0);
    expect(closedFiles).toHaveLength(1);
  });
});
