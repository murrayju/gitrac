import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createDefaultConfig } from '../../core/config.ts';
import { initIssuesDir } from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import type { ServerContext } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';
import { assetRoutes, MAX_UPLOAD_BYTES, serveAsset } from './assets.ts';

let dir: string;
let app: Hono;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-assets-test-'));
  await initIssuesDir(dir);
  const ctx: ServerContext = {
    dir,
    config: createDefaultConfig(),
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(dir),
  };
  app = new Hono();
  app.route('/api', assetRoutes(ctx));
  app.get('/.issues/assets/:filename', serveAsset(ctx));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function upload(file: File): Promise<Response> {
  const form = new FormData();
  form.append('file', file);
  return Promise.resolve(
    app.request('http://localhost/api/issues/assets', {
      method: 'POST',
      body: form,
    }),
  );
}

describe('POST /api/issues/assets', () => {
  test('accepts a PNG', async () => {
    const res = await upload(
      new File([new Uint8Array([137, 80, 78, 71])], 'a.png'),
    );
    expect(res.status).toBe(201);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/^\/\.issues\/assets\/.+\.png$/);
  });

  test('rejects SVG uploads', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    for (const name of ['x.svg', 'x.SVG']) {
      const res = await upload(new File([svg], name));
      expect(res.status).toBe(400);
    }
  });

  test('rejects uploads over the size limit', async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    const res = await upload(new File([big], 'big.png'));
    expect(res.status).toBe(413);
  });

  test('rejects oversized streamed bodies without Content-Length', async () => {
    const form = new FormData();
    form.append(
      'file',
      new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'b.png'),
    );
    const encoded = new Response(form);
    const res = await app.request('http://localhost/api/issues/assets', {
      method: 'POST',
      headers: {
        'content-type': encoded.headers.get('content-type') ?? '',
        'transfer-encoding': 'chunked',
      },
      body: encoded.body,
      // @ts-expect-error duplex is required for streaming bodies
      duplex: 'half',
    });
    expect(res.status).toBe(413);
  });
});

describe('serving assets', () => {
  async function put(name: string, content: string): Promise<void> {
    await mkdir(join(dir, '.issues', 'assets'), { recursive: true });
    await writeFile(join(dir, '.issues', 'assets', name), content);
  }

  test('sets nosniff and a sandbox CSP on every asset', async () => {
    await put('a.png', 'png');
    for (const path of ['/.issues/assets/a.png', '/api/issues/assets/a.png']) {
      const res = await app.request(`http://localhost${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-security-policy')).toContain('sandbox');
      expect(res.headers.get('content-disposition')).toBeNull();
    }
  });

  test('pre-existing SVGs are served sandboxed', async () => {
    await put('old.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const res = await app.request('http://localhost/.issues/assets/old.svg');
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('sandbox');
    expect(csp).toContain("default-src 'none'");
  });

  test('unknown file types are forced to download', async () => {
    await put('evil.html', '<script>alert(1)</script>');
    const res = await app.request('http://localhost/.issues/assets/evil.html');
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toBe('attachment');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
