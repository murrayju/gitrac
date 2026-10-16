import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import type { Issue } from '../core/types.ts';
import {
  initIssuesDir,
  readConfig,
  writeConfig,
  writeIssue,
} from '../fs/issue-store.ts';
import { AmendTracker } from '../git/amend-tracker.ts';
import { IdentityResolver } from '../git/identity.ts';
import type { ServerContext } from './server.ts';
import { createApp } from './server.ts';
import { IssueWatcher } from './watcher.ts';

/**
 * Regression tests for #64: the web API behaves like the CLI (one commit
 * message wording, autoPush honored, bad bodies are 400, malformed issue
 * files are a clear `invalid_issue` error).
 */

let base: string;
let dir: string;
let ctx: ServerContext;
let prefix: string;

async function initRepo(path: string): Promise<void> {
  const git = simpleGit(path);
  await git.init(['--initial-branch=main']);
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'gitrac-web-parity-'));
  dir = join(base, 'work');
  await Bun.write(join(dir, 'README.md'), 'hello');
  await initRepo(dir);
  await initIssuesDir(dir);
  const git = simpleGit(dir);
  await git.add('.');
  await git.commit('initial');
  const config = await readConfig(dir);
  prefix = config.git.commitPrefix;
  ctx = {
    dir,
    config,
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(dir),
    identity: new IdentityResolver(dir, { author: 'Tester' }),
  };
});

afterEach(async () => {
  ctx.watcher.stop();
  await rm(base, { recursive: true, force: true });
});

function api(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(
    createApp(ctx).request(`http://localhost/api${path}`, init),
  );
}

function send(method: string, path: string, body?: unknown): Promise<Response> {
  return api(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function setAutoPush(): Promise<void> {
  const config = await readConfig(dir);
  config.git.autoPush = true;
  await writeConfig(dir, config);
  const git = simpleGit(dir);
  await git.add('.');
  await git.commit('enable autoPush');
}

describe('PATCH /api/config/* with a bad body', () => {
  for (const route of ['labels', 'assignees']) {
    test(`/config/${route}: invalid JSON or null is 400, not 500`, async () => {
      for (const body of ['not json', 'null', '[]']) {
        const res = await api(`/config/${route}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body,
        });
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toContain(
          route,
        );
      }
    });
  }
});

describe('commit messages match the CLI', () => {
  test('a field edit is "edit #N <title>"', async () => {
    // Not amendable (committed outside the server), so a fresh commit
    await writeIssue(dir, {
      id: 1,
      title: 'Existing',
      status: 'backlog',
      priority: 'medium',
      assignee: '',
      labels: [],
      created: '2025-01-01T00:00:00Z',
      createdBy: 'tester',
      updated: '2025-01-01T00:00:00Z',
      description: '',
      comments: [],
    });
    const git = simpleGit(dir);
    await git.add('.');
    await git.commit('add issue');

    const res = await send('PATCH', '/issues/1', { priority: 'high' });
    expect(res.status).toBe(200);
    const latest = (await git.log()).latest;
    expect(latest?.message).toBe(`${prefix} edit #1 Existing`);
    // config.yaml unchanged, so not part of the commit
    const files = await git.raw(['show', '--name-only', '--format=', 'HEAD']);
    expect(files.trim()).toBe('.issues/1-existing.md');
  });
});

describe('claim / unclaim match the CLI (#103)', () => {
  test('commit message, files and error codes', async () => {
    // Committed outside the server, so the claim is a fresh commit.
    await writeIssue(dir, {
      id: 1,
      title: 'Existing',
      status: 'todo',
      priority: 'medium',
      assignee: '',
      labels: [],
      created: '2025-01-01T00:00:00Z',
      createdBy: 'tester',
      updated: '2025-01-01T00:00:00Z',
      description: '',
      comments: [],
    });
    const git = simpleGit(dir);
    await git.add('.');
    await git.commit('add issue');

    const config = await readConfig(dir);
    config.assignees = [{ name: 'Grace', email: 'grace@example.com' }];
    await writeConfig(dir, config);
    await git.add('.');
    await git.commit('add assignee');

    const res = await send('POST', '/issues/1/claim', { author: 'Grace' });
    expect(res.status).toBe(200);
    expect((await git.log()).latest?.message).toBe(
      `${prefix} claim #1 Existing`,
    );
    const files = await git.raw(['show', '--name-only', '--format=', 'HEAD']);
    expect(files.trim()).toBe('.issues/1-existing.md');

    // Same codes as the CLI's JSON errors (exit 3 / exit 4).
    const taken = await send('POST', '/issues/1/claim', {});
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { code: string }).code).toBe(
      'already_claimed',
    );
    const released = await send('POST', '/issues/1/unclaim', {
      author: 'Grace',
    });
    expect(released.status).toBe(200);
    expect(((await released.json()) as Issue).status).toBe('todo');
    await send('PATCH', '/issues/1/close', {});
    const closed = await send('POST', '/issues/1/unclaim', {});
    expect(closed.status).toBe(409);
    expect(((await closed.json()) as { code: string }).code).toBe(
      'issue_closed',
    );
    expect((await git.status()).isClean()).toBe(true);
  });
});

describe('POST /api/issues with a closed status (#67)', () => {
  test('writes and commits the issue in .issues/closed/', async () => {
    const res = await send('POST', '/issues', {
      title: 'Done already',
      status: 'done',
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Issue).status).toBe('done');
    expect(
      await Bun.file(join(dir, '.issues', '1-done-already.md')).exists(),
    ).toBe(false);
    const git = simpleGit(dir);
    expect((await git.log()).latest?.message).toBe(
      `${prefix} create #1 Done already`,
    );
    const files = await git.raw(['show', '--name-only', '--format=', 'HEAD']);
    expect(files.trim()).toBe('.issues/closed/1-done-already.md');
    expect((await git.status()).isClean()).toBe(true);
  });
});

describe('autoPush', () => {
  let remote: string;

  beforeEach(async () => {
    remote = join(base, 'remote.git');
    await simpleGit(base).raw(['init', '--bare', remote]);
    const git = simpleGit(dir);
    await git.addRemote('origin', remote);
    await git.push(['-u', 'origin', 'main']);
  });

  async function remoteLog(): Promise<string[]> {
    const out = await simpleGit(remote).raw(['log', '--format=%s', 'main']);
    return out.trim().split('\n');
  }

  test('web commits are pushed when config.git.autoPush is set', async () => {
    await setAutoPush();
    await simpleGit(dir).push();

    const created = await send('POST', '/issues', { title: 'Pushed' });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as Issue;
    expect((await remoteLog())[0]).toBe(`${prefix} create #${id} Pushed`);

    // The pushed commit isn't amended: the next edit is a new, pushed commit
    const res = await send('PATCH', `/issues/${id}`, { priority: 'high' });
    expect(res.status).toBe(200);
    expect((await remoteLog()).slice(0, 2)).toEqual([
      `${prefix} edit #${id} Pushed`,
      `${prefix} create #${id} Pushed`,
    ]);
    const status = await simpleGit(dir).status();
    expect(status.ahead).toBe(0);
  });

  test('without autoPush nothing is pushed (and edits amend)', async () => {
    const before = await remoteLog();
    const created = await send('POST', '/issues', { title: 'Local' });
    const { id } = (await created.json()) as Issue;
    await send('PATCH', `/issues/${id}`, { priority: 'high' });
    expect(await remoteLog()).toEqual(before);
    expect((await simpleGit(dir).log()).latest?.message).toBe(
      `${prefix} create #${id} Local (+ edits)`,
    );
  });

  test('a failed push does not fail the request', async () => {
    await setAutoPush();
    await simpleGit(dir).remote(['set-url', 'origin', join(base, 'gone')]);
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(' '));
    try {
      const res = await send('POST', '/issues', { title: 'Offline' });
      expect(res.status).toBe(201);
    } finally {
      console.error = original;
    }
    expect((await simpleGit(dir).log()).latest?.message).toBe(
      `${prefix} create #1 Offline`,
    );
    expect(String(errors[0])).toContain('push failed');
  });
});

describe('malformed issue files', () => {
  test('GET and mutations answer 409 invalid_issue and write nothing', async () => {
    const path = join(dir, '.issues', '2-bad.md');
    await writeFile(path, 'no frontmatter here\n');
    const expected = {
      code: 'invalid_issue',
      file: join('.issues', '2-bad.md'),
    };

    const get = await api('/issues/2');
    expect(get.status).toBe(409);
    expect(await get.json()).toMatchObject(expected);

    for (const [method, route, body] of [
      ['PATCH', '/issues/2', { title: 'x' }],
      ['POST', '/issues/2/comments', { body: 'hi' }],
      ['PATCH', '/issues/2/close', {}],
    ] as const) {
      const res = await send(method, route, body);
      expect(res.status).toBe(409);
      const json = (await res.json()) as { error: string };
      expect(json).toMatchObject(expected);
      expect(json.error).toContain('no YAML frontmatter');
    }
    expect(await Bun.file(path).text()).toBe('no frontmatter here\n');
    expect(await Bun.file(join(dir, '.issues', 'NaN-x.md')).exists()).toBe(
      false,
    );
  });
});

describe('error precedence matches the CLI', () => {
  test('a bad reopen status is 400 even for a missing issue', async () => {
    const res = await send('PATCH', '/issues/99/reopen', { status: 'bogus' });
    expect(res.status).toBe(400);
  });
});
