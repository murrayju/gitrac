import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { createDefaultConfig } from '../core/config.ts';
import { initIssuesDir } from '../fs/issue-store.ts';
import { AmendTracker } from '../git/amend-tracker.ts';
import type { ServerContext } from './server.ts';
import { createApp, displayUrl, startServer } from './server.ts';
import { IssueWatcher } from './watcher.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-server-test-'));
  await initIssuesDir(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeCtx(overrides: Partial<ServerContext> = {}): ServerContext {
  return {
    dir,
    config: createDefaultConfig(),
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(dir),
    ...overrides,
  };
}

describe('SPA fallback', () => {
  test('serves index.html content for non-API routes', async () => {
    // Create a fake dist/ui directory with an index.html
    const distUiDir = join(dir, 'dist', 'ui');
    await mkdir(distUiDir, { recursive: true });
    const htmlContent =
      '<!DOCTYPE html><html><head><title>gitrac</title></head><body><div id="root"></div></body></html>';
    await writeFile(join(distUiDir, 'index.html'), htmlContent);

    const app = createApp(makeCtx());
    const res = await app.request('http://localhost/issues/5');

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(htmlContent);
    expect(body).not.toContain('[object Blob]');
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  test('serves index.html for deeply nested SPA routes', async () => {
    const distUiDir = join(dir, 'dist', 'ui');
    await mkdir(distUiDir, { recursive: true });
    const htmlContent = '<!DOCTYPE html><html><body>app</body></html>';
    await writeFile(join(distUiDir, 'index.html'), htmlContent);

    const app = createApp(makeCtx());
    const res = await app.request('http://localhost/some/deep/route');

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(htmlContent);
  });

  test('API routes still work when dist dir exists', async () => {
    const distUiDir = join(dir, 'dist', 'ui');
    await mkdir(distUiDir, { recursive: true });
    await writeFile(join(distUiDir, 'index.html'), '<html></html>');

    const config = createDefaultConfig();
    config.git.autoCommit = false;
    const app = createApp(makeCtx({ config }));

    const res = await app.request('http://localhost/api/issues');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});

function noCommitCtx(): ServerContext {
  const config = createDefaultConfig();
  config.git.autoCommit = false;
  return makeCtx({ config });
}

function createIssueReq(headers: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/issues', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ title: 'From somewhere' }),
  });
}

describe('request guard (CORS / CSRF / DNS rebinding)', () => {
  test('does not send CORS headers', async () => {
    const app = createApp(noCommitCtx());
    const res = await app.request('http://localhost:3000/api/issues', {
      headers: { origin: 'https://evil.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('CORS preflight is not answered with an allow', async () => {
    const app = createApp(noCommitCtx());
    const res = await app.request('http://localhost:3000/api/issues', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-methods')).toBeNull();
  });

  test('rejects cross-origin mutations', async () => {
    const app = createApp(noCommitCtx());
    const res = await app.request(
      createIssueReq({
        host: 'localhost:3000',
        origin: 'https://evil.example',
      }),
    );
    expect(res.status).toBe(403);
    const list = await app.request('http://localhost:3000/api/issues');
    expect(await list.json()).toEqual([]);
  });

  test('rejects requests with a rebound Host', async () => {
    const app = createApp(noCommitCtx());
    const post = await app.request(
      createIssueReq({
        host: 'evil.example:3000',
        origin: 'http://evil.example:3000',
      }),
    );
    expect(post.status).toBe(403);
    const get = await app.request('http://localhost:3000/api/issues', {
      headers: { host: 'evil.example:3000' },
    });
    expect(get.status).toBe(403);
  });

  test('allows same-origin mutations', async () => {
    const app = createApp(noCommitCtx());
    const res = await app.request(
      createIssueReq({
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
      }),
    );
    expect(res.status).toBe(201);
  });

  test('allows mutations through the Vite dev proxy', async () => {
    const app = createApp(noCommitCtx());
    const res = await app.request(
      createIssueReq({
        host: 'localhost:5173',
        origin: 'http://localhost:5173',
      }),
    );
    expect(res.status).toBe(201);
  });

  test('accepts the --host name when bound to it', async () => {
    const app = createApp(noCommitCtx(), { host: 'mybox.lan' });
    const res = await app.request('http://mybox.lan:3000/api/issues', {
      headers: { host: 'mybox.lan:3000' },
    });
    expect(res.status).toBe(200);
  });
});

describe('startServer', () => {
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => {});
    spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    (console.log as unknown as { mockRestore(): void }).mockRestore();
    (console.warn as unknown as { mockRestore(): void }).mockRestore();
  });

  async function gitDir(): Promise<void> {
    const git = simpleGit(dir);
    await git.init();
    await git.raw(['checkout', '-b', 'main']);
  }

  test('binds to 127.0.0.1 by default', async () => {
    await gitDir();
    const server = await startServer({
      dir,
      port: 0,
      config: createDefaultConfig(),
    });
    try {
      expect(server.hostname).toBe('127.0.0.1');
      const res = await fetch(`http://127.0.0.1:${server.port}/api/issues`);
      expect(res.status).toBe(200);
    } finally {
      await server.stop();
    }
  });

  test('--host opts into another interface', async () => {
    await gitDir();
    const server = await startServer({
      dir,
      port: 0,
      host: '0.0.0.0',
      config: createDefaultConfig(),
    });
    try {
      expect(server.hostname).toBe('0.0.0.0');
    } finally {
      await server.stop();
    }
  });
});

describe('displayUrl', () => {
  test('formats the startup URL', () => {
    expect(displayUrl('127.0.0.1', 3000)).toBe('http://localhost:3000');
    expect(displayUrl('0.0.0.0', 3000)).toBe('http://localhost:3000');
    expect(displayUrl('192.168.1.5', 3000)).toBe('http://192.168.1.5:3000');
    expect(displayUrl('::1', 3000)).toBe('http://[::1]:3000');
  });
});
