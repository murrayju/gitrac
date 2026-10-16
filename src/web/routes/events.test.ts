import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'bun';
import { Hono } from 'hono';
import { createDefaultConfig } from '../../core/config.ts';
import { initIssuesDir } from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import type { ServerContext } from '../server.ts';
import { createApp } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';
import { eventsRoute } from './events.ts';

let dir: string;
let ctx: ServerContext;
let server: Server<undefined> | null = null;
const clients: AbortController[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-events-test-'));
  await initIssuesDir(dir);
  ctx = {
    dir,
    config: createDefaultConfig(),
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(dir),
  };
  ctx.watcher.start();
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.abort();
  ctx.watcher.stop();
  await server?.stop(true);
  server = null;
  await rm(dir, { recursive: true, force: true });
});

/** An open SSE connection that accumulates everything received. */
interface SseClient {
  text(): string;
  /** Resolve once the received text matches, or reject after `timeoutMs`. */
  waitFor(pattern: RegExp, timeoutMs?: number): Promise<void>;
  /** True once the server ended the stream. */
  ended(): boolean;
  close(): void;
}

async function connect(url: string): Promise<SseClient> {
  const controller = new AbortController();
  clients.push(controller);
  const res = await fetch(url, { signal: controller.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body?.getReader();
  if (!reader) throw new Error('no body');
  const decoder = new TextDecoder();
  let received = '';
  let done = false;
  (async () => {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        received += decoder.decode(chunk.value, { stream: true });
      }
    } catch {
      // aborted / connection reset
    }
    done = true;
  })();

  return {
    text: () => received,
    ended: () => done,
    close: () => controller.abort(),
    async waitFor(pattern, timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      while (!pattern.test(received)) {
        if (done) throw new Error(`stream ended; got: ${received}`);
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${pattern}; got: ${received}`);
        }
        await Bun.sleep(20);
      }
    },
  };
}

/** Make an external change to `.issues/` so the watcher fires. */
async function touchIssues(): Promise<void> {
  await writeFile(join(dir, '.issues', `external-${Date.now()}.md`), 'x');
}

async function waitUntil(cond: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await Bun.sleep(20);
  }
}

describe('GET /api/events over a real Bun.serve', () => {
  test('stays connected past idleTimeout and still delivers events', async () => {
    // Bun enforces idleTimeout with a coarse (~4s) timer: an idle stream
    // with idleTimeout: 1 is dropped after ~4s. Wait comfortably past that.
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      idleTimeout: 1,
      fetch: createApp(ctx).fetch,
    });
    const client = await connect(`http://127.0.0.1:${server.port}/api/events`);
    await client.waitFor(/event: connected/);

    await Bun.sleep(5500);
    expect(client.ended()).toBe(false);

    await touchIssues();
    await client.waitFor(/event: issues-changed/);
    expect(client.ended()).toBe(false);
  }, 15000);

  test('writes keep-alive comments on an idle stream', async () => {
    // Served without the Bun server as `env`, so only the keep-alive writes
    // keep the connection from looking idle (as behind a proxy).
    const app = new Hono().route(
      '/api',
      eventsRoute(ctx, { keepAliveMs: 100 }),
    );
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (req) => app.fetch(req),
    });
    const client = await connect(`http://127.0.0.1:${server.port}/api/events`);
    await client.waitFor(/event: connected/);
    await client.waitFor(/(: keep-alive\n\n[\s\S]*){3}/);

    // Keep-alives don't get in the way of real events.
    await touchIssues();
    await client.waitFor(/event: issues-changed/);
  });

  test('delivers events for .issues/closed/ created after start', async () => {
    // Git does not track the empty `.issues/closed/`, so a fresh clone has
    // none when the server starts. Start a watcher without it.
    ctx.watcher.stop();
    await rm(join(dir, '.issues', 'closed'), { recursive: true, force: true });
    ctx.watcher = new IssueWatcher(dir);
    ctx.watcher.start();
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: createApp(ctx).fetch,
    });
    const client = await connect(`http://127.0.0.1:${server.port}/api/events`);
    await client.waitFor(/event: connected/);

    // The first close creates the directory.
    await mkdir(join(dir, '.issues', 'closed'));
    await client.waitFor(/event: issues-changed/);
    await waitUntil(() => ctx.watcher.watchedDirCount() === 2);
    await Bun.sleep(300);

    // An edit inside `.issues/closed/` gives a new event and generation.
    const seen = client.text().length;
    const gen = ctx.watcher.generation();
    await writeFile(join(dir, '.issues', 'closed', '1-closed.md'), 'x');
    await waitUntil(() => ctx.watcher.generation() > gen);
    await waitUntil(() =>
      client.text().slice(seen).includes('event: issues-changed'),
    );
  });

  test('removes watcher listeners when clients disconnect', async () => {
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: createApp(ctx).fetch,
    });
    const url = `http://127.0.0.1:${server.port}/api/events`;
    expect(ctx.watcher.listenerCount()).toBe(0);

    const a = await connect(url);
    const b = await connect(url);
    await a.waitFor(/event: connected/);
    await b.waitFor(/event: connected/);
    expect(ctx.watcher.listenerCount()).toBe(2);

    a.close();
    await waitUntil(() => ctx.watcher.listenerCount() === 1);

    // The remaining client still gets events.
    await touchIssues();
    await b.waitFor(/event: issues-changed/);

    b.close();
    await waitUntil(() => ctx.watcher.listenerCount() === 0);
  }, 10000);
});
