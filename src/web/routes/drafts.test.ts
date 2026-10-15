import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createDefaultConfig } from '../../core/config.ts';
import { ISSUES_GITIGNORE_PATH } from '../../fs/gitignore.ts';
import { initIssuesDir } from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import type { ServerContext } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';
import { draftRoutes } from './drafts.ts';

let dir: string;
let app: Hono;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-drafts-test-'));
  await initIssuesDir(dir);
  const ctx: ServerContext = {
    dir,
    config: createDefaultConfig(),
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(dir),
  };
  app = new Hono();
  app.route('/api', draftRoutes(ctx));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const put = (filename: string, body: unknown) =>
  app.request(`http://localhost/api/drafts/${filename}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('PUT /api/drafts/:filename', () => {
  test('saves the draft and gitignores drafts in an existing project', async () => {
    // A project initialized before init wrote .issues/.gitignore.
    await rm(join(dir, ISSUES_GITIGNORE_PATH), { force: true });
    const res = await put('d1.json', { title: 'Draft' });
    expect(res.status).toBe(200);
    expect(
      JSON.parse(
        await readFile(join(dir, '.issues', 'drafts', 'd1.json'), 'utf-8'),
      ),
    ).toMatchObject({ title: 'Draft' });
    expect(
      (await readFile(join(dir, ISSUES_GITIGNORE_PATH), 'utf-8')).split('\n'),
    ).toContain('drafts/');
  });

  test('leaves an existing .issues/.gitignore that already covers everything alone', async () => {
    await writeFile(
      join(dir, ISSUES_GITIGNORE_PATH),
      'custom\n/drafts\n.*.tmp\n',
    );
    expect((await put('d2.json', { title: 'Draft' })).status).toBe(200);
    expect(await readFile(join(dir, ISSUES_GITIGNORE_PATH), 'utf-8')).toBe(
      'custom\n/drafts\n.*.tmp\n',
    );
  });

  test('a rejected filename writes nothing', async () => {
    expect((await put('x.txt', {})).status).toBe(400);
    expect(await Bun.file(join(dir, ISSUES_GITIGNORE_PATH)).exists()).toBe(
      false,
    );
  });
});
