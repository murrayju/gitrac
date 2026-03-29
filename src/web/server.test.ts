import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultConfig } from '../core/config.ts';
import { initIssuesDir } from '../fs/issue-store.ts';
import { AmendTracker } from '../git/amend-tracker.ts';
import type { ServerContext } from './server.ts';
import { createApp } from './server.ts';
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
