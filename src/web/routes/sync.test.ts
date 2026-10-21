import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDefaultConfig } from '../../core/config.ts';
import type { SyncResult, SyncStatus } from '../../core/sync.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import {
  type RemotesFixture,
  remotesFixture,
} from '../../git/remotes.fixture.ts';
import { createApp, type ServerContext } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';

let f: RemotesFixture;
let ctx: ServerContext;

beforeEach(async () => {
  f = await remotesFixture();
  ctx = {
    dir: f.work,
    config: createDefaultConfig(),
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(f.work),
  };
});

afterEach(async () => {
  await f.cleanup();
});

function send(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const app = createApp(ctx, { ui: null });
  return Promise.resolve(
    app.request(`http://localhost/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

type OperationResponse = { result: SyncResult; status: SyncStatus };

describe('GET /api/git/sync', () => {
  test('reports the branch and each remote', async () => {
    await f.commitFile(f.work, 'a', '1', 'local work');
    const res = await send('GET', '/git/sync');
    expect(res.status).toBe(200);
    const status = (await res.json()) as SyncStatus;
    expect(status.branch).toBe('main');
    expect(status.summary).toEqual({
      state: 'out-of-sync',
      ahead: 1,
      behind: 0,
    });
    expect(status.remotes[0]?.toPush.commits[0]?.subject).toBe('local work');
  });

  test('redacts credentials in remote URLs', async () => {
    await f.git(
      f.work,
      'remote',
      'add',
      'gh',
      'https://user:token@example.com/r.git',
    );
    const status = (await (
      await send('GET', '/git/sync')
    ).json()) as SyncStatus;
    const gh = status.remotes.find((r) => r.name === 'gh');
    expect(gh?.url).toBe('https://***@example.com/r.git');
    expect(JSON.stringify(status)).not.toContain('token');
  });
});

describe('POST /api/git/sync/*', () => {
  test('sync pushes and returns the new status', async () => {
    await f.commitFile(f.work, 'a', '1', 'local work');
    const res = await send('POST', '/git/sync/sync', {});
    expect(res.status).toBe(200);
    const { result, status } = (await res.json()) as OperationResponse;
    expect(result.ok).toBe(true);
    expect(result.remotes[0]?.pushed).toBe('pushed');
    expect(status.summary.state).toBe('in-sync');
  });

  test('a conflict is a 200 with the error for the remote', async () => {
    await f.commitFile(f.work, 'README.md', 'ours\n');
    await f.commitFile(f.peer, 'README.md', 'theirs\n');
    await f.git(f.peer, 'push', '-q');
    const res = await send('POST', '/git/sync/sync');
    expect(res.status).toBe(200);
    const { result, status } = (await res.json()) as OperationResponse;
    expect(result.ok).toBe(false);
    expect(result.remotes[0]?.error?.kind).toBe('conflict');
    expect(status.summary.state).toBe('conflict');
    expect(await f.git(f.work, 'status', '--porcelain')).toBe('');
  });

  test('a merge in progress is 409', async () => {
    await f.commitFile(f.work, 'README.md', 'ours\n');
    await f.commitFile(f.peer, 'README.md', 'theirs\n');
    await f.git(f.peer, 'push', '-q');
    await f.git(f.work, 'fetch', '-q');
    await f.git(f.work, 'merge', 'origin/main').catch(() => {});
    const res = await send('POST', '/git/sync/sync');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'invalid_state',
      reason: 'operation',
      operation: 'merge',
    });
  });

  test('fetch, pull and push accept one remote', async () => {
    await f.commitFile(f.peer, 'b', '2', 'peer');
    await f.git(f.peer, 'push', '-q');
    let res = await send('POST', '/git/sync/fetch', { remote: 'origin' });
    let body = (await res.json()) as OperationResponse;
    expect(body.result.remotes).toEqual([{ remote: 'origin', fetched: true }]);
    expect(body.status.summary.behind).toBe(1);
    res = await send('POST', '/git/sync/pull', { remote: 'origin' });
    body = (await res.json()) as OperationResponse;
    expect(body.result.remotes[0]?.integrated).toBe('fast-forward');
    await f.addRemote('backup');
    res = await send('POST', '/git/sync/push', { remote: 'backup' });
    body = (await res.json()) as OperationResponse;
    expect(body.result.remotes[0]?.pushed).toBe('created');
  });

  test('bad input is 400, an unknown remote 404', async () => {
    expect((await send('POST', '/git/sync/sync', { remote: 5 })).status).toBe(
      400,
    );
    expect(
      (await send('POST', '/git/sync/sync', { remote: 'nope' })).status,
    ).toBe(404);
  });

  test('cross-origin requests are refused', async () => {
    const res = await send('POST', '/git/sync/sync', undefined, {
      Origin: 'http://evil.example',
    });
    expect(res.status).toBe(403);
  });

  test('a sync that integrates or pushes ends the amend window', async () => {
    const hash = await f.commitFile(f.work, 'a', '1');
    ctx.amendTracker.record(1, hash);
    expect(await ctx.amendTracker.canAmend(f.work, 1)).toBe(true);
    await send('POST', '/git/sync/sync');
    expect(await ctx.amendTracker.canAmend(f.work, 1)).toBe(false);
  });
});

describe('PUT /api/git/sync/remotes/:name', () => {
  test('excludes and includes a remote', async () => {
    let res = await send('PUT', '/git/sync/remotes/origin', {
      included: false,
    });
    expect(res.status).toBe(200);
    let status = (await res.json()) as SyncStatus;
    expect(status.remotes[0]?.included).toBe(false);
    expect(status.summary.state).toBe('excluded');
    res = await send('PUT', '/git/sync/remotes/origin', { included: true });
    status = (await res.json()) as SyncStatus;
    expect(status.remotes[0]?.included).toBe(true);
  });

  test('validates the body and the remote', async () => {
    expect(
      (await send('PUT', '/git/sync/remotes/origin', { included: 'no' }))
        .status,
    ).toBe(400);
    expect(
      (await send('PUT', '/git/sync/remotes/nope', { included: false })).status,
    ).toBe(404);
  });
});

test('local changes in the way are reported for the remote', async () => {
  await f.commitFile(f.peer, 'README.md', 'theirs\n');
  await f.git(f.peer, 'push', '-q');
  await writeFile(join(f.work, 'README.md'), 'dirty\n');
  const res = await send('POST', '/git/sync/sync');
  const { result } = (await res.json()) as OperationResponse;
  expect(result.remotes[0]?.error?.kind).toBe('local-changes');
});
