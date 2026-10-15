import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { createDefaultConfig } from '../../core/config.ts';
import type { Issue } from '../../core/types.ts';
import { initIssuesDir, readIssue } from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import { IdentityResolver } from '../../git/identity.ts';
import { createApp, type ServerContext } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-web-identity-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.name', 'Ada Lovelace');
  await git.addConfig('user.email', 'ada@example.com');
  await git.addConfig('commit.gpgsign', 'false');
  await initIssuesDir(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeApp(identity?: IdentityResolver) {
  const config = createDefaultConfig();
  config.git.autoCommit = false;
  const ctx: ServerContext = {
    dir,
    config,
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(dir),
    identity,
  };
  const app = createApp(ctx);
  return (path: string, body?: unknown) =>
    app.request(`http://localhost/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}

describe('web identity (git config)', () => {
  test('GET /api/identity returns the git identity', async () => {
    const req = makeApp();
    const res = await req('/identity');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });
  });

  test('createdBy and comment authors come from git, not "web"', async () => {
    const req = makeApp();
    const created = (await (
      await req('/issues', { title: 'From the UI' })
    ).json()) as Issue;
    expect(created.createdBy).toBe('Ada Lovelace');

    await req(`/issues/${created.id}/comments`, { body: 'hello' });
    const onDisk = await readIssue(dir, created.id);
    expect(onDisk.createdBy).toBe('Ada Lovelace');
    expect(onDisk.comments[0]?.author).toBe('Ada Lovelace');
  });

  test('picks up git config changes without a restart', async () => {
    const req = makeApp(new IdentityResolver(dir, { maxAgeMs: 0 }));
    await req('/identity');
    await simpleGit(dir).addConfig('user.name', 'Grace Hopper');
    const created = (await (
      await req('/issues', { title: 'After rename' })
    ).json()) as Issue;
    expect(created.createdBy).toBe('Grace Hopper');
  });

  test('--author overrides git config', async () => {
    const req = makeApp(new IdentityResolver(dir, { author: 'Server Bot' }));
    expect(await (await req('/identity')).json()).toEqual({
      name: 'Server Bot',
      email: '',
    });
    const created = (await (
      await req('/issues', { title: 'Bot issue' })
    ).json()) as Issue;
    expect(created.createdBy).toBe('Server Bot');
  });
});
