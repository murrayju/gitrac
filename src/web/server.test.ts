import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import simpleGit from 'simple-git';
import { createDefaultConfig } from '../core/config.ts';
import { initIssuesDir, writeConfig } from '../fs/issue-store.ts';
import { AmendTracker } from '../git/amend-tracker.ts';
import type { ServerContext } from './server.ts';
import { createApp, displayUrl, startServer } from './server.ts';
import {
  clearEmbeddedUi,
  directoryUiAssets,
  embeddedUiAssets,
  registerEmbeddedUi,
} from './ui-assets.ts';
import { IssueWatcher } from './watcher.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-server-test-'));
  await initIssuesDir(dir);
  // No git repo here: disable auto-commit on disk (the server re-reads
  // config.yaml per request, so ctx.config alone isn't enough).
  const config = createDefaultConfig();
  config.git.autoCommit = false;
  await writeConfig(dir, config);
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

async function makeDistDir(files: Record<string, string>): Promise<string> {
  const distUiDir = join(dir, 'gitrac-dist', 'ui');
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(distUiDir, name)), { recursive: true });
    await writeFile(join(distUiDir, name), content);
  }
  return distUiDir;
}

describe('SPA fallback', () => {
  test('serves index.html content for non-API routes', async () => {
    const htmlContent =
      '<!DOCTYPE html><html><head><title>gitrac</title></head><body><div id="root"></div></body></html>';
    const distUiDir = await makeDistDir({ 'index.html': htmlContent });

    const app = createApp(makeCtx(), { ui: directoryUiAssets(distUiDir) });
    const res = await app.request('http://localhost/issues/5');

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(htmlContent);
    expect(body).not.toContain('[object Blob]');
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  test('serves index.html for deeply nested SPA routes', async () => {
    const htmlContent = '<!DOCTYPE html><html><body>app</body></html>';
    const distUiDir = await makeDistDir({ 'index.html': htmlContent });

    const app = createApp(makeCtx(), { ui: directoryUiAssets(distUiDir) });
    const res = await app.request('http://localhost/some/deep/route');

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(htmlContent);
  });

  test('API routes still work when a UI is served', async () => {
    const distUiDir = await makeDistDir({ 'index.html': '<html></html>' });

    const config = createDefaultConfig();
    config.git.autoCommit = false;
    const app = createApp(makeCtx({ config }), {
      ui: directoryUiAssets(distUiDir),
    });

    const res = await app.request('http://localhost/api/issues');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("never serves the served project's own dist/ui", async () => {
    // An unrelated app in the repo being served must not be mistaken for
    // gitrac's UI (the old cwd / project-dir fallback).
    await mkdir(join(dir, 'dist', 'ui'), { recursive: true });
    await writeFile(
      join(dir, 'dist', 'ui', 'index.html'),
      '<html>NOT-GITRAC</html>',
    );
    await writeFile(join(dir, 'dist', 'ui', 'other.js'), 'NOT-GITRAC');

    const app = createApp(makeCtx());
    for (const path of ['/', '/issues/1', '/other.js']) {
      const res = await app.request(`http://localhost${path}`);
      expect(await res.text()).not.toContain('NOT-GITRAC');
    }
  });

  test('ui: null serves only the API', async () => {
    const app = createApp(noCommitCtx(), { ui: null });
    expect((await app.request('http://localhost/')).status).toBe(404);
    expect((await app.request('http://localhost/api/issues')).status).toBe(200);
  });
});

describe('unknown /api routes', () => {
  const notFound = { error: 'Not found', code: 'not_found' };

  async function uiApp() {
    const distUiDir = await makeDistDir({ 'index.html': '<html>SPA</html>' });
    return createApp(noCommitCtx(), { ui: directoryUiAssets(distUiDir) });
  }

  test('return a JSON 404 for every method, not index.html', async () => {
    const app = await uiApp();
    const paths = [
      '/api',
      '/api/',
      '/api/does-not-exist',
      '/api/issues/1/nope/deeper',
    ];
    for (const path of paths) {
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const res = await app.request(`http://localhost${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: method === 'GET' ? undefined : '{}',
        });
        expect({ path, method, status: res.status }).toEqual({
          path,
          method,
          status: 404,
        });
        expect(res.headers.get('content-type')).toContain('application/json');
        expect(await res.json()).toEqual(notFound);
      }
    }
  });

  test('also without a UI', async () => {
    const app = createApp(noCommitCtx(), { ui: null });
    const res = await app.request('http://localhost/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(notFound);
  });

  test('known API routes, SPA routes and issue assets are unaffected', async () => {
    await mkdir(join(dir, '.issues', 'assets'), { recursive: true });
    await writeFile(join(dir, '.issues', 'assets', 'pic.png'), 'PNGDATA');
    const app = await uiApp();

    expect((await app.request('http://localhost/api/issues')).status).toBe(200);
    expect((await app.request('http://localhost/api/config')).status).toBe(200);

    for (const path of ['/', '/issues/5', '/apidocs', '/api-not-really']) {
      const res = await app.request(`http://localhost${path}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('<html>SPA</html>');
    }

    const asset = await app.request('http://localhost/.issues/assets/pic.png');
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('PNGDATA');
  });

  test('a missing issue is still the route-specific 404', async () => {
    const app = await uiApp();
    const res = await app.request('http://localhost/api/issues/999');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Issue #999 not found');
  });
});

describe('embedded UI', () => {
  afterEach(() => clearEmbeddedUi());

  async function embedded(): Promise<Record<string, string>> {
    const distUiDir = await makeDistDir({
      'index.html': '<html>EMBEDDED</html>',
      'assets/index-abc123.js': 'console.log("embedded")',
      'assets/index-def456.css': 'body{}',
      'favicon.svg': '<svg/>',
    });
    // Stand-ins for the `$bunfs` paths `import ... with { type: 'file' }`
    // yields in a compiled binary; deliberately unrelated to the URL paths.
    return {
      '/index.html': join(distUiDir, 'index.html'),
      '/assets/index-abc123.js': join(distUiDir, 'assets', 'index-abc123.js'),
      '/assets/index-def456.css': join(distUiDir, 'assets', 'index-def456.css'),
      '/favicon.svg': join(distUiDir, 'favicon.svg'),
    };
  }

  test('registered manifest is served by default', async () => {
    registerEmbeddedUi(await embedded());
    // Even with a project dist/ui present.
    await mkdir(join(dir, 'dist', 'ui'), { recursive: true });
    await writeFile(join(dir, 'dist', 'ui', 'index.html'), 'NOT-GITRAC');

    const app = createApp(makeCtx());

    const root = await app.request('http://localhost/');
    expect(root.status).toBe(200);
    expect(await root.text()).toBe('<html>EMBEDDED</html>');
    expect(root.headers.get('content-type')).toContain('text/html');
    expect(root.headers.get('cache-control')).toBe('no-cache');

    const js = await app.request('http://localhost/assets/index-abc123.js');
    expect(js.status).toBe(200);
    expect(await js.text()).toBe('console.log("embedded")');
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect(js.headers.get('cache-control')).toContain('immutable');

    const css = await app.request('http://localhost/assets/index-def456.css');
    expect(css.headers.get('content-type')).toContain('text/css');

    const svg = await app.request('http://localhost/favicon.svg');
    expect(svg.headers.get('content-type')).toContain('image/svg+xml');

    const spa = await app.request('http://localhost/issues/7');
    expect(spa.status).toBe(200);
    expect(await spa.text()).toBe('<html>EMBEDDED</html>');
  });

  test('missing hashed asset is a 404, not index.html', async () => {
    const app = createApp(makeCtx(), {
      ui: embeddedUiAssets(await embedded()),
    });
    const res = await app.request('http://localhost/assets/index-gone.js');
    expect(res.status).toBe(404);
  });

  test('HEAD is answered without a body', async () => {
    const app = createApp(makeCtx(), {
      ui: embeddedUiAssets(await embedded()),
    });
    const res = await app.request('http://localhost/', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
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
