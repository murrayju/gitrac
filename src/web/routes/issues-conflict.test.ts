import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import simpleGit from 'simple-git';
import type { Issue } from '../../core/types.ts';
import {
  initIssuesDir,
  readConfig,
  readIssue,
  readIssueContent,
  writeIssue,
} from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import { issueETag } from '../etag.ts';
import type { ServerContext } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';
import { issueRoutes } from './issues.ts';

/**
 * Regression tests for #45: the web editor's autosave must not silently
 * revert changes made outside the browser. Single-issue responses carry an
 * ETag; mutations honor `If-Match` and return 409 when the issue changed.
 */

let dir: string;
let app: Hono;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-web-conflict-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await initIssuesDir(dir);
  await git.add('.');
  await git.commit('initial');

  const ctx: ServerContext = {
    dir,
    config: await readConfig(dir),
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
  body?: unknown,
  ifMatch?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (ifMatch !== undefined) headers['If-Match'] = ifMatch;
  return app.request(`http://localhost/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createIssue(): Promise<{ issue: Issue; etag: string }> {
  const res = await send('POST', '/issues', {
    title: 'Concurrency',
    description: 'Original description.',
  });
  expect(res.status).toBe(201);
  const etag = res.headers.get('ETag');
  expect(etag).toBeTruthy();
  return { issue: (await res.json()) as Issue, etag: etag as string };
}

/** Simulate the CLI / an agent / git pull editing the file directly. */
async function externalEdit(id: number, description: string): Promise<void> {
  const issue = await readIssue(dir, id);
  issue.description = description;
  issue.updated = new Date(Date.now() + 1000).toISOString();
  await writeIssue(dir, issue);
}

async function diskETag(id: number): Promise<string> {
  const raw = await readIssueContent(dir, id);
  if (!raw) throw new Error('missing');
  return issueETag(raw.content);
}

async function commitCount(): Promise<number> {
  return (await simpleGit(dir).log()).total;
}

describe('ETag on issue responses', () => {
  test('GET /issues/:id returns the ETag of the file on disk', async () => {
    const { issue, etag } = await createIssue();
    const res = await send('GET', `/issues/${issue.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBe(etag);
    expect(etag).toBe(await diskETag(issue.id));
  });

  test('ETag changes when the file is edited externally', async () => {
    const { issue, etag } = await createIssue();
    await externalEdit(issue.id, 'Changed by the CLI.');
    const res = await send('GET', `/issues/${issue.id}`);
    expect(res.headers.get('ETag')).not.toBe(etag);
    expect(res.headers.get('ETag')).toBe(await diskETag(issue.id));
  });
});

describe('PATCH /issues/:id with If-Match', () => {
  test('returns 409 and leaves the external change intact when stale', async () => {
    const { issue, etag } = await createIssue();
    await externalEdit(issue.id, 'Changed by the CLI.');
    const before = await readFile(
      join(
        dir,
        '.issues',
        (await readIssueContent(dir, issue.id))?.filename ?? '',
      ),
      'utf-8',
    );
    const commitsBefore = await commitCount();

    const res = await send(
      'PATCH',
      `/issues/${issue.id}`,
      { description: 'Stale editor content.' },
      etag,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; current: Issue };
    expect(body.error).toContain('modified');
    expect(body.current.description).toBe('Changed by the CLI.');
    expect(res.headers.get('ETag')).toBe(await diskETag(issue.id));

    const after = await readIssueContent(dir, issue.id);
    expect(after?.content).toBe(before);
    expect(await commitCount()).toBe(commitsBefore);
  });

  test('succeeds when If-Match matches and returns the new ETag', async () => {
    const { issue, etag } = await createIssue();
    const res = await send(
      'PATCH',
      `/issues/${issue.id}`,
      { description: 'Edited in the browser.' },
      etag,
    );
    expect(res.status).toBe(200);
    const newETag = res.headers.get('ETag');
    expect(newETag).toBeTruthy();
    expect(newETag).not.toBe(etag);
    expect(newETag).toBe(await diskETag(issue.id));
    expect((await readIssue(dir, issue.id)).description).toBe(
      'Edited in the browser.',
    );
  });

  test('chained autosaves using the returned ETag never conflict', async () => {
    const { issue, etag: first } = await createIssue();
    let etag = first;
    // Include a rename (title) and a move to closed/ and back
    const updates: Record<string, unknown>[] = [
      { description: '\n\n# Heading\n\n* bullet\n\ntext  \n\n\n' },
      { title: 'Renamed issue' },
      { status: 'done' },
      { description: 'While closed' },
      { status: 'todo' },
    ];
    for (const update of updates) {
      const res = await send('PATCH', `/issues/${issue.id}`, update, etag);
      expect(res.status).toBe(200);
      etag = res.headers.get('ETag') as string;
      const get = await send('GET', `/issues/${issue.id}`);
      expect(get.headers.get('ETag')).toBe(etag);
      // The response body is exactly what a later GET returns, so the UI
      // can compare descriptions across save responses and refetches.
      expect(await res.json()).toEqual(await get.json());
    }
  });

  test('a stale ETag from before our own save conflicts', async () => {
    const { issue, etag } = await createIssue();
    const ok = await send(
      'PATCH',
      `/issues/${issue.id}`,
      { description: 'one' },
      etag,
    );
    expect(ok.status).toBe(200);
    const stale = await send(
      'PATCH',
      `/issues/${issue.id}`,
      { description: 'two' },
      etag,
    );
    expect(stale.status).toBe(409);
    expect((await readIssue(dir, issue.id)).description).toBe('one');
  });

  test('without If-Match keeps last-writer-wins', async () => {
    const { issue } = await createIssue();
    await externalEdit(issue.id, 'Changed by the CLI.');
    const res = await send('PATCH', `/issues/${issue.id}`, {
      priority: 'high',
    });
    expect(res.status).toBe(200);
    const after = await readIssue(dir, issue.id);
    expect(after.priority).toBe('high');
    expect(after.description).toBe('Changed by the CLI.');
  });

  test('If-Match: * matches any existing issue', async () => {
    const { issue } = await createIssue();
    await externalEdit(issue.id, 'Changed by the CLI.');
    const res = await send(
      'PATCH',
      `/issues/${issue.id}`,
      { description: 'forced' },
      '*',
    );
    expect(res.status).toBe(200);
  });

  test('404 still wins over a precondition for missing issues', async () => {
    const res = await send(
      'PATCH',
      '/issues/999',
      { description: 'x' },
      '"nope"',
    );
    expect(res.status).toBe(404);
  });
});

describe('comment routes with If-Match', () => {
  async function withComment(): Promise<{ id: number; etag: string }> {
    const { issue } = await createIssue();
    const res = await send('POST', `/issues/${issue.id}/comments`, {
      body: 'first',
    });
    expect(res.status).toBe(200);
    return { id: issue.id, etag: res.headers.get('ETag') as string };
  }

  test('PUT comment returns 409 when the issue changed', async () => {
    const { id, etag } = await withComment();
    await externalEdit(id, 'Changed by the CLI.');
    const res = await send(
      'PUT',
      `/issues/${id}/comments/0`,
      { body: 'edited' },
      etag,
    );
    expect(res.status).toBe(409);
    expect((await readIssue(dir, id)).comments[0]?.body).toBe('first');
  });

  test('DELETE comment returns 409 when the issue changed', async () => {
    const { id, etag } = await withComment();
    await externalEdit(id, 'Changed by the CLI.');
    const res = await send(
      'DELETE',
      `/issues/${id}/comments/0`,
      undefined,
      etag,
    );
    expect(res.status).toBe(409);
    expect((await readIssue(dir, id)).comments).toHaveLength(1);
  });

  test('PUT comment succeeds with a current ETag', async () => {
    const { id, etag } = await withComment();
    const res = await send(
      'PUT',
      `/issues/${id}/comments/0`,
      { body: 'edited' },
      etag,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBe(await diskETag(id));
  });
});
