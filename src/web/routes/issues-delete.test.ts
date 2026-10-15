import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import simpleGit from 'simple-git';
import type { Issue } from '../../core/types.ts';
import {
  findIssueFile,
  initIssuesDir,
  readConfig,
  readIssue,
} from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import type { ServerContext } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';
import { issueRoutes } from './issues.ts';

/** Regression tests for #59: `DELETE /api/issues/:id`. */

let dir: string;
let app: Hono;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-web-delete-'));
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

function send(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(`http://localhost/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function create(fields: Record<string, unknown>): Promise<Issue> {
  const res = await send('POST', '/issues', fields);
  expect(res.status).toBe(201);
  return (await res.json()) as Issue;
}

async function subjects(): Promise<string[]> {
  return (await simpleGit(dir).log()).all.map((e) => e.message);
}

async function tracked(): Promise<string[]> {
  const out = await simpleGit(dir).raw(['ls-files', '.issues']);
  return out.split('\n').filter(Boolean);
}

describe('DELETE /api/issues/:id', () => {
  test('deletes the issue and its orphaned assets in a new commit', async () => {
    await mkdir(join(dir, '.issues', 'assets'), { recursive: true });
    await writeFile(join(dir, '.issues', 'assets', 'a.png'), 'img');
    await writeFile(join(dir, '.issues', 'assets', 'shared.png'), 'img');
    const issue = await create({
      title: 'Dupe',
      description:
        '![a](/.issues/assets/a.png) ![s](/.issues/assets/shared.png)',
    });
    await create({ title: 'Other', description: '/.issues/assets/shared.png' });

    const res = await send('DELETE', `/issues/${issue.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      deleted: true,
      issue: { id: issue.id, title: 'Dupe' },
      paths: [
        join('.issues', `${issue.id}-dupe.md`),
        join('.issues', 'assets', 'a.png'),
      ],
      assets: [join('.issues', 'assets', 'a.png')],
    });
    // Not folded into the create commit (which would leave it empty).
    expect((await subjects())[0]).toBe(`issue: delete #${issue.id} Dupe`);
    expect((await subjects())[1]).toBe('issue: create #2 Other');
    const files = await tracked();
    expect(files).not.toContain(`.issues/${issue.id}-dupe.md`);
    expect(files).not.toContain('.issues/assets/a.png');
    expect(files).toContain('.issues/assets/shared.png');
    expect((await send('GET', `/issues/${issue.id}`)).status).toBe(404);
  });

  test('deleting right after creating leaves create + delete commits', async () => {
    const issue = await create({ title: 'Oops' });
    expect((await send('DELETE', `/issues/${issue.id}`)).status).toBe(200);
    expect(await subjects()).toEqual([
      `issue: delete #${issue.id} Oops`,
      `issue: create #${issue.id} Oops`,
      'initial',
    ]);
    expect((await simpleGit(dir).status()).isClean()).toBe(true);
  });

  test('honors If-Match: a stale version is 409 with the current issue', async () => {
    const issue = await create({ title: 'Guarded' });
    const get = await send('GET', `/issues/${issue.id}`);
    const etag = get.headers.get('ETag') ?? '';
    expect(
      (await send('PATCH', `/issues/${issue.id}`, { priority: 'high' })).status,
    ).toBe(200);

    const res = await send('DELETE', `/issues/${issue.id}`, undefined, {
      'If-Match': etag,
    });

    expect(res.status).toBe(409);
    expect(res.headers.get('ETag')).toBeTruthy();
    const body = (await res.json()) as { current: Issue };
    expect(body.current.priority).toBe('high');
    expect(await findIssueFile(dir, issue.id)).not.toBeNull();
  });

  test('a matching If-Match deletes', async () => {
    const issue = await create({ title: 'Current' });
    const etag =
      (await send('GET', `/issues/${issue.id}`)).headers.get('ETag') ?? '';
    const res = await send('DELETE', `/issues/${issue.id}`, undefined, {
      'If-Match': etag,
    });
    expect(res.status).toBe(200);
    expect(await findIssueFile(dir, issue.id)).toBeNull();
  });

  test('missing issue is 404, bad ID is 400', async () => {
    expect((await send('DELETE', '/issues/99')).status).toBe(404);
    expect((await send('DELETE', '/issues/abc')).status).toBe(400);
  });

  test('removes links to the deleted issue in the same commit (#68)', async () => {
    const gone = await create({ title: 'Gone' });
    const blocked = await create({ title: 'Blocked' });
    const child = await create({ title: 'Child' });
    for (const [id, body] of [
      [blocked.id, { blockedBy: gone.id }],
      [child.id, { parent: gone.id }],
    ] as const) {
      expect((await send('POST', `/issues/${id}/link`, body)).status).toBe(200);
    }

    const res = await send('DELETE', `/issues/${gone.id}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { unlinked: unknown[] };
    expect(body.unlinked).toEqual([
      {
        id: blocked.id,
        title: 'Blocked',
        blockedBy: true,
        parent: false,
        paths: [join('.issues', `${blocked.id}-blocked.md`)],
      },
      {
        id: child.id,
        title: 'Child',
        blockedBy: false,
        parent: true,
        paths: [join('.issues', `${child.id}-child.md`)],
      },
    ]);
    expect((await readIssue(dir, blocked.id)).blockedBy).toBeUndefined();
    expect((await readIssue(dir, child.id)).parent).toBeUndefined();
    expect((await subjects())[0]).toBe(`issue: delete #${gone.id} Gone`);
    expect((await simpleGit(dir).status()).isClean()).toBe(true);
  });
});

/** Regression tests for #75: `DELETE /api/issues/:id?dryRun=1`. */
describe('DELETE /api/issues/:id?dryRun=1', () => {
  test('returns the plan (issue, assets, unlinked) and writes nothing', async () => {
    await mkdir(join(dir, '.issues', 'assets'), { recursive: true });
    await writeFile(join(dir, '.issues', 'assets', 'a.png'), 'img');
    const gone = await create({
      title: 'Gone',
      description: '![a](/.issues/assets/a.png)',
    });
    const blocked = await create({ title: 'Blocked' });
    const child = await create({ title: 'Child' });
    for (const [id, body] of [
      [blocked.id, { blockedBy: gone.id }],
      [child.id, { parent: gone.id }],
    ] as const) {
      expect((await send('POST', `/issues/${id}/link`, body)).status).toBe(200);
    }
    const before = await subjects();
    const filesBefore = await tracked();
    const etag =
      (await send('GET', `/issues/${gone.id}`)).headers.get('ETag') ?? '';

    const res = await send('DELETE', `/issues/${gone.id}?dryRun=1`);

    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBe(etag);
    expect(await res.json()).toEqual({
      deleted: false,
      issue: expect.objectContaining({ id: gone.id, title: 'Gone' }),
      paths: [
        join('.issues', `${gone.id}-gone.md`),
        join('.issues', 'assets', 'a.png'),
      ],
      assets: [join('.issues', 'assets', 'a.png')],
      unlinked: [
        {
          id: blocked.id,
          title: 'Blocked',
          blockedBy: true,
          parent: false,
          paths: [join('.issues', `${blocked.id}-blocked.md`)],
        },
        {
          id: child.id,
          title: 'Child',
          blockedBy: false,
          parent: true,
          paths: [join('.issues', `${child.id}-child.md`)],
        },
      ],
    });
    expect(await subjects()).toEqual(before);
    expect(await tracked()).toEqual(filesBefore);
    expect((await simpleGit(dir).status()).isClean()).toBe(true);
    expect(await findIssueFile(dir, gone.id)).not.toBeNull();
    expect((await readIssue(dir, blocked.id)).blockedBy).toEqual([gone.id]);
    expect((await readIssue(dir, child.id)).parent).toBe(gone.id);
  });

  test('accepts dryRun=true; dryRun=0 really deletes', async () => {
    const issue = await create({ title: 'Maybe' });
    const dry = await send('DELETE', `/issues/${issue.id}?dryRun=true`);
    expect(dry.status).toBe(200);
    expect(((await dry.json()) as { deleted: boolean }).deleted).toBe(false);
    expect(await findIssueFile(dir, issue.id)).not.toBeNull();

    const real = await send('DELETE', `/issues/${issue.id}?dryRun=0`);
    expect(real.status).toBe(200);
    expect(((await real.json()) as { deleted: boolean }).deleted).toBe(true);
    expect(await findIssueFile(dir, issue.id)).toBeNull();
  });

  test('the plan ETag confirms the deletion; a change since is 409', async () => {
    const issue = await create({ title: 'Planned' });
    const plan = await send('DELETE', `/issues/${issue.id}?dryRun=1`);
    const etag = plan.headers.get('ETag') ?? '';
    expect(etag).toBeTruthy();
    expect(
      (await send('PATCH', `/issues/${issue.id}`, { priority: 'high' })).status,
    ).toBe(200);

    const stale = await send('DELETE', `/issues/${issue.id}`, undefined, {
      'If-Match': etag,
    });
    expect(stale.status).toBe(409);
    expect(await findIssueFile(dir, issue.id)).not.toBeNull();

    const fresh = await send('DELETE', `/issues/${issue.id}?dryRun=1`);
    const res = await send('DELETE', `/issues/${issue.id}`, undefined, {
      'If-Match': fresh.headers.get('ETag') ?? '',
    });
    expect(res.status).toBe(200);
    expect(await findIssueFile(dir, issue.id)).toBeNull();
  });

  test('honors If-Match, and 404/400 like a real delete', async () => {
    const issue = await create({ title: 'Guarded' });
    const res = await send(
      'DELETE',
      `/issues/${issue.id}?dryRun=1`,
      undefined,
      {
        'If-Match': '"stale"',
      },
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { current: Issue }).current.id).toBe(
      issue.id,
    );
    expect((await send('DELETE', '/issues/99?dryRun=1')).status).toBe(404);
    expect((await send('DELETE', '/issues/abc?dryRun=1')).status).toBe(400);
  });
});
