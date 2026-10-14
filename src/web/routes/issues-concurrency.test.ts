import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import simpleGit from 'simple-git';
import type { Issue } from '../../core/types.ts';
import {
  initIssuesDir,
  listIssueFiles,
  readConfig,
  readIssue,
} from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import type { ServerContext } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';
import { issueRoutes } from './issues.ts';

/**
 * Regression tests for #38: overlapping web requests (autosave, comments,
 * creates) must be serialized, and must not race with CLI processes.
 */

const ENTRY = join(import.meta.dir, '..', '..', '..', 'index.ts');
const N = 8;

let dir: string;
let app: Hono;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-web-concurrency-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await initIssuesDir(dir);
  await git.add('.');
  await git.commit('initial');

  const ctx: ServerContext = {
    dir,
    config: await readConfig(dir),
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(dir),
  };
  app = new Hono();
  app.route('/api', issueRoutes(ctx));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function post(path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(`http://localhost/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function commitCount(): Promise<number> {
  return (await simpleGit(dir).log()).total;
}

describe('concurrent web mutations', () => {
  test(`${N} concurrent POST /issues produce ${N} distinct IDs and ${N} commits`, async () => {
    const before = await commitCount();
    const responses = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        post('/issues', { title: `Web ${i}` }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(N).fill(201));
    const ids = await Promise.all(
      responses.map(async (r) => ((await r.json()) as Issue).id),
    );
    expect([...ids].sort((a, b) => a - b)).toEqual(
      Array.from({ length: N }, (_, i) => i + 1),
    );
    expect(await commitCount()).toBe(before + N);
    expect((await readConfig(dir)).nextId).toBe(N + 1);
    expect((await simpleGit(dir).status()).files).toEqual([]);
  }, 60_000);

  test(`${N} concurrent comments on one issue are all kept`, async () => {
    expect((await post('/issues', { title: 'Target' })).status).toBe(201);
    const responses = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        post('/issues/1/comments', { body: `comment ${i}` }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(N).fill(200));
    const issue = await readIssue(dir, 1);
    expect(issue.comments.map((c) => c.body).sort()).toEqual(
      Array.from({ length: N }, (_, i) => `comment ${i}`).sort(),
    );
    // Comments on the same issue amend the create commit: nothing left over
    expect((await simpleGit(dir).status()).files).toEqual([]);
    const committed = await simpleGit(dir).show(['HEAD:.issues/1-target.md']);
    for (let i = 0; i < N; i++) {
      expect(committed).toContain(`comment ${i}`);
    }
  }, 60_000);

  test('web requests and CLI processes racing never collide', async () => {
    const half = N / 2;
    const cliRuns = Array.from({ length: half }, async (_, i) => {
      const proc = Bun.spawn(
        [
          process.execPath,
          ENTRY,
          '--dir',
          dir,
          '--author',
          'Tester',
          'create',
          '-t',
          `CLI ${i}`,
        ],
        { stdout: 'ignore', stderr: 'pipe' },
      );
      const [stderr, code] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, stderr: stderr.trim() };
    });
    const webRuns = Array.from({ length: half }, (_, i) =>
      post('/issues', { title: `Web ${i}` }),
    );
    const [cliResults, webResults] = await Promise.all([
      Promise.all(cliRuns),
      Promise.all(webRuns),
    ]);
    expect(cliResults).toEqual(Array(half).fill({ code: 0, stderr: '' }));
    expect(webResults.map((r) => r.status)).toEqual(Array(half).fill(201));

    const files = await listIssueFiles(dir);
    const ids = new Set(files.map((f) => Number.parseInt(f, 10)));
    expect(files.length).toBe(N);
    expect(ids.size).toBe(N);
    expect((await readConfig(dir)).nextId).toBe(N + 1);
    expect((await simpleGit(dir).status()).files).toEqual([]);
  }, 60_000);
});
