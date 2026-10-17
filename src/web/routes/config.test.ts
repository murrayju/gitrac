import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createDefaultConfig } from '../../core/config.ts';
import {
  initIssuesDir,
  readConfig,
  writeConfig,
} from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import type { ServerContext } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';
import { configRoutes } from './config.ts';

let dir: string;
let app: Hono;
let ctx: ServerContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-api-config-'));
  await initIssuesDir(dir);
  const config = createDefaultConfig();
  config.git.autoCommit = false;
  // The server re-reads config.yaml per request; persist it.
  await writeConfig(dir, config);
  ctx = {
    dir,
    config,
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(dir),
  };
  app = new Hono();
  app.route('/api', configRoutes(ctx));
});

afterEach(async () => {
  ctx.watcher.stop();
  await rm(dir, { recursive: true, force: true });
});

function patchAssignees(assignees: unknown): Promise<Response> {
  return Promise.resolve(
    app.request('http://localhost/api/config/assignees', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignees }),
    }),
  );
}

describe('PATCH /api/config/assignees', () => {
  test('replaces the assignees', async () => {
    const assignees = [{ name: 'Ada', email: 'ada@example.com' }];
    const res = await patchAssignees(assignees);
    expect(res.status).toBe(200);
    expect((await res.json()).assignees).toEqual(assignees);
    expect((await readConfig(dir)).assignees).toEqual(assignees);
  });

  test('400 for a name or email with a line break or em dash (#109)', async () => {
    const before = await Bun.file(join(dir, '.issues', 'config.yaml')).text();
    const res = await patchAssignees([
      { name: 'Ada', email: 'ada@example.com' },
      { name: 'Bad \u2014 Name', email: 'bad@example.com' },
      { name: 'Eve', email: 'eve@x\n.com' },
    ]);
    expect(res.status).toBe(400);
    const errors = [
      'Invalid assignee name "Bad \u2014 Name": must not contain the em dash (U+2014)',
      'Invalid assignee email "eve@x\\n.com": must not contain line breaks',
    ];
    expect(await res.json()).toEqual({ error: errors.join('; '), errors });
    expect(await Bun.file(join(dir, '.issues', 'config.yaml')).text()).toBe(
      before,
    );
  });

  test('400 for one bad entry has no errors list', async () => {
    const res = await patchAssignees([{ name: 'A\nB', email: 'a@x.com' }]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Invalid assignee name "A\\nB": must not contain line breaks',
    });
  });
});
