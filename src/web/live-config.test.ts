import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'bun';
import simpleGit from 'simple-git';
import type { Config, Issue } from '../core/types.ts';
import { initIssuesDir, readConfig, writeConfig } from '../fs/issue-store.ts';
import { AmendTracker } from '../git/amend-tracker.ts';
import { IdentityResolver } from '../git/identity.ts';
import { reloadConfig } from './live-config.ts';
import type { ServerContext } from './server.ts';
import { createApp } from './server.ts';
import { IssueWatcher } from './watcher.ts';

let dir: string;
let ctx: ServerContext;
let server: Server<undefined> | null = null;
const clients: AbortController[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-live-config-'));
  await initIssuesDir(dir);
  const config = await readConfig(dir);
  config.git.autoCommit = false;
  await writeConfig(dir, config);
  ctx = {
    dir,
    // The snapshot the server started with.
    config: await readConfig(dir),
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(dir),
    identity: new IdentityResolver(dir, { author: 'Tester' }),
  };
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.abort();
  ctx.watcher.stop();
  await server?.stop(true);
  server = null;
  await rm(dir, { recursive: true, force: true });
});

/** Simulate the CLI (another process) editing config.yaml. */
async function editConfigOnDisk(change: (c: Config) => void): Promise<void> {
  const config = await readConfig(dir);
  change(config);
  await writeConfig(dir, config);
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return createApp(ctx).request(`http://localhost/api${path}`, init);
}

function post(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('server config is never a stale startup snapshot', () => {
  test('GET /api/config reflects config.yaml changes made by the CLI', async () => {
    await editConfigOnDisk((c) => {
      c.assignees.push({ name: 'Grace Hopper', email: 'grace@example.com' });
      c.labels.urgentfix = '#ff0000';
    });

    const res = await api('/config');
    expect(res.status).toBe(200);
    const config = (await res.json()) as Config;
    expect(config.assignees).toEqual([
      { name: 'Grace Hopper', email: 'grace@example.com' },
    ]);
    expect(config.labels.urgentfix).toBe('#ff0000');
  });

  test('mutations use the current defaults from config.yaml', async () => {
    await editConfigOnDisk((c) => {
      c.defaultPriority = 'high';
      c.defaultStatus = 'todo';
    });

    const res = await post('/issues', { title: 'Uses fresh defaults' });
    expect(res.status).toBe(201);
    const issue = (await res.json()) as Issue;
    expect(issue.priority).toBe('high');
    expect(issue.status).toBe('todo');
  });

  test('mutations use the current git settings from config.yaml', async () => {
    const git = simpleGit(dir);
    await git.init();
    await git.addConfig('user.name', 'Tester');
    await git.addConfig('user.email', 'tester@example.com');
    await git.addConfig('commit.gpgsign', 'false');
    await git.add('.');
    await git.commit('init');

    // Server started with autoCommit off; the CLI turns it on.
    expect(ctx.config.git.autoCommit).toBe(false);
    await editConfigOnDisk((c) => {
      c.git.autoCommit = true;
      c.git.commitPrefix = '[fresh]';
    });

    const res = await post('/issues', { title: 'Commit me' });
    expect(res.status).toBe(201);
    const log = await git.log();
    expect(log.latest?.message).toStartWith('[fresh]');
  });

  test('label PATCH merges into the current file and keeps CLI changes', async () => {
    await editConfigOnDisk((c) => {
      c.assignees.push({ name: 'Ada', email: 'ada@example.com' });
    });
    const res = await api('/config/labels', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ labels: { bug: '#000000' } }),
    });
    expect(res.status).toBe(200);
    const config = (await res.json()) as Config;
    expect(config.labels.bug).toBe('#000000');
    expect(config.assignees).toHaveLength(1);
    expect((await readConfig(dir)).assignees).toHaveLength(1);
  });

  test('keeps the last good config if config.yaml is unreadable', async () => {
    await editConfigOnDisk((c) => {
      c.defaultPriority = 'low';
    });
    expect((await reloadConfig(ctx)).defaultPriority).toBe('low');

    await writeFile(join(dir, '.issues', 'config.yaml'), 'not: [valid');
    const res = await api('/config');
    expect(res.status).toBe(200);
    expect(((await res.json()) as Config).defaultPriority).toBe('low');
  });
});

describe('config.yaml changes reach the UI', () => {
  test('emits an SSE event, after which GET /api/config is fresh', async () => {
    ctx.watcher.start();
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: createApp(ctx).fetch,
    });
    const base = `http://127.0.0.1:${server.port}`;

    const controller = new AbortController();
    clients.push(controller);
    const res = await fetch(`${base}/api/events`, {
      signal: controller.signal,
    });
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');
    const decoder = new TextDecoder();
    let received = '';
    (async () => {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          received += decoder.decode(chunk.value, { stream: true });
        }
      } catch {
        // aborted
      }
    })();
    const waitFor = async (pattern: RegExp) => {
      const deadline = Date.now() + 3000;
      while (!pattern.test(received)) {
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${pattern}; got ${received}`);
        }
        await Bun.sleep(20);
      }
    };
    await waitFor(/event: connected/);

    await editConfigOnDisk((c) => {
      c.assignees.push({ name: 'Grace Hopper', email: 'grace@example.com' });
    });
    await waitFor(/event: issues-changed/);

    // What the UI's shared config store does on `issues-changed`.
    const config = (await (await fetch(`${base}/api/config`)).json()) as Config;
    expect(config.assignees.map((a) => a.name)).toEqual(['Grace Hopper']);
  });
});
