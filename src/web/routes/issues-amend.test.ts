import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import simpleGit from 'simple-git';
import type { Issue } from '../../core/types.ts';
import { initIssuesDir, readConfig } from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import type { ServerContext } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';
import { issueRoutes } from './issues.ts';

/**
 * Regression tests for #49: amending a web commit must not replace the
 * first operation's message (e.g. `create #N title`).
 */

let dir: string;
let app: Hono;
let prefix: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-web-amend-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await initIssuesDir(dir);
  await git.add('.');
  await git.commit('initial');

  const config = await readConfig(dir);
  prefix = config.git.commitPrefix;
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

function send(method: string, path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(`http://localhost/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function log() {
  return simpleGit(dir).log();
}

describe('web amend keeps the original commit message', () => {
  test('create + update amends into "create #N title (+ edits)"', async () => {
    const before = (await log()).total;
    const created = await send('POST', '/issues', { title: 'Amend me' });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as Issue;

    const res = await send('PATCH', `/issues/${id}`, { priority: 'high' });
    expect(res.status).toBe(200);

    const after = await log();
    expect(after.total).toBe(before + 1);
    expect(after.latest?.message).toBe(
      `${prefix} create #${id} Amend me (+ edits)`,
    );
  });

  test('create + update + comment still shows the create', async () => {
    const created = await send('POST', '/issues', { title: 'Busy' });
    const { id } = (await created.json()) as Issue;
    await send('PATCH', `/issues/${id}`, { description: 'More detail' });
    await send('POST', `/issues/${id}/comments`, { body: 'note' });

    expect((await log()).latest?.message).toBe(
      `${prefix} create #${id} Busy (+ edits)`,
    );
  });

  test('comment + update keeps the comment message', async () => {
    const created = await send('POST', '/issues', { title: 'Other' });
    const { id } = (await created.json()) as Issue;
    // Break the amend chain so the comment starts a fresh commit
    await send('POST', '/issues', { title: 'Unrelated' });
    const before = (await log()).total;

    await send('POST', `/issues/${id}/comments`, { body: 'hello' });
    await send('PATCH', `/issues/${id}`, { priority: 'low' });

    const after = await log();
    expect(after.total).toBe(before + 1);
    expect(after.latest?.message).toBe(
      `${prefix} comment on #${id} Other (+ edits)`,
    );
  });
});
