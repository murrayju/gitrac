import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import type { BranchState } from '../../core/branches.ts';
import { readConfig, writeConfig } from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import {
  type BranchRepo,
  branchRepo,
  startConflictingMerge,
} from '../../git/branches.fixture.ts';
import { readBranchState } from '../../git/branches.ts';
import { withRepoLock } from '../../git/lock.ts';
import { ElsewhereCache } from '../elsewhere-cache.ts';
import { createApp, type ServerContext } from '../server.ts';
import { IssueWatcher } from '../watcher.ts';

let repo: BranchRepo;
let dir: string;
let ctx: ServerContext;
let scans: number;

beforeEach(async () => {
  repo = await branchRepo();
  dir = repo.dir;
  // A different config on `feature`, to check that it is re-read.
  const git = simpleGit(dir);
  await git.raw(['switch', '-q', 'feature']);
  const featureConfig = await readConfig(dir);
  featureConfig.git.commitPrefix = 'feature:';
  await writeConfig(dir, featureConfig);
  await git.commit('feature config', ['.issues/config.yaml']);
  await git.raw(['switch', '-q', 'main']);

  scans = 0;
  ctx = {
    dir,
    config: await readConfig(dir),
    amendTracker: new AmendTracker(),
    watcher: new IssueWatcher(dir),
  };
  ctx.elsewhere = new ElsewhereCache(dir, {
    scan: async () => {
      scans++;
      return new Map();
    },
  });
});

afterEach(async () => {
  ctx.watcher.stop();
  await repo.cleanup();
});

const ORIGIN = 'http://localhost:3000';

function postSwitch(
  body: unknown,
  headers: Record<string, string> = { origin: ORIGIN },
): Promise<Response> {
  const app = createApp(ctx, { ui: null });
  return Promise.resolve(
    app.request(`${ORIGIN}/api/git/switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

async function current(): Promise<string | null> {
  return (await readBranchState(dir)).current;
}

describe('GET /api/git/branches', () => {
  test('the branch state', async () => {
    const app = createApp(ctx, { ui: null });
    const res = await app.request(`${ORIGIN}/api/git/branches`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BranchState;
    expect(body.current).toBe('main');
    expect(body.detached).toBe(false);
    expect(body.head).toMatch(/^[0-9a-f]+$/);
    expect(body.branches.map((b) => b.name)).toEqual([
      'feature',
      'main',
      'plain',
    ]);
    expect(body.dirty).toBe(false);
    expect(body.operation).toBeNull();
  });

  test('reports dirty files and a merge in progress', async () => {
    await startConflictingMerge(dir);
    const app = createApp(ctx, { ui: null });
    const body = (await (
      await app.request(`${ORIGIN}/api/git/branches`)
    ).json()) as BranchState;
    expect(body.operation).toBe('merge');
    expect(body.dirty).toBe(true);
    expect(body.dirtyPaths).toContain('README.md');
  });
});

describe('POST /api/git/switch', () => {
  test('switches, then resets the amend tracker, scan cache and config', async () => {
    const clear = spyOn(ctx.amendTracker, 'clear');
    await ctx.elsewhere?.states();
    expect(scans).toBe(1);
    const res = await postSwitch({ branch: 'feature' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      previous: string;
      switched: boolean;
      state: BranchState;
    };
    expect(body.previous).toBe('main');
    expect(body.switched).toBe(true);
    expect(body.state.current).toBe('feature');
    expect(await current()).toBe('feature');
    expect(clear).toHaveBeenCalled();
    await ctx.elsewhere?.states();
    expect(scans).toBe(2);
    expect(ctx.config.git.commitPrefix).toBe('feature:');
  });

  test('the current branch is a no-op', async () => {
    const clear = spyOn(ctx.amendTracker, 'clear');
    const res = await postSwitch({ branch: 'main' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { switched: boolean }).switched).toBe(false);
    expect(clear).not.toHaveBeenCalled();
  });

  test('409 with the dirty paths', async () => {
    await writeFile(join(dir, 'README.md'), 'edit\n');
    const res = await postSwitch({ branch: 'feature' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      code: string;
      paths: string[];
    };
    expect(body.code).toBe('invalid_state');
    expect(body.error).toContain('README.md');
    expect(body.paths).toEqual(['README.md']);
    expect(await current()).toBe('main');
  });

  test('409 while a merge is in progress', async () => {
    await startConflictingMerge(dir);
    const res = await postSwitch({ branch: 'feature' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { operation: string }).operation).toBe(
      'merge',
    );
  });

  test('409 for a branch in another worktree', async () => {
    const wt = join(repo.base, 'wt');
    await simpleGit(dir).raw(['worktree', 'add', '-q', wt, 'feature']);
    const res = await postSwitch({ branch: 'feature' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { worktree: string }).worktree).toBe(wt);
  });

  test('409 with the git message when git refuses', async () => {
    const git = simpleGit(dir);
    await git.raw(['switch', '-q', '-c', 'tracks-other']);
    await writeFile(join(dir, 'other.txt'), 'theirs\n');
    await git.add('other.txt');
    await git.commit('add other.txt');
    await git.raw(['switch', '-q', 'main']);
    await writeFile(join(dir, 'other.txt'), 'mine\n');
    const res = await postSwitch({ branch: 'tracks-other' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('git_error');
    expect(body.error).toContain('other.txt');
  });

  test('400 for unknown, option-like or missing names', async () => {
    for (const body of [
      { branch: 'nope' },
      { branch: '--orphan' },
      { branch: '-' },
      { branch: 7 },
      {},
      'not json',
    ]) {
      const res = await postSwitch(body);
      expect(res.status).toBe(400);
    }
    expect(await current()).toBe('main');
  });

  test('403 cross-origin', async () => {
    const res = await postSwitch(
      { branch: 'feature' },
      { origin: 'https://evil.example' },
    );
    expect(res.status).toBe(403);
    expect(await current()).toBe('main');
  });

  test('waits for the repo lock (mutationLock)', async () => {
    let release!: () => void;
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => {
      locked = r;
    });
    const holder = withRepoLock(
      dir,
      () =>
        new Promise<void>((r) => {
          release = r;
          locked();
        }),
    );
    await isLocked;
    let done = false;
    const pending = postSwitch({ branch: 'feature' }).then((res) => {
      done = true;
      return res;
    });
    await Bun.sleep(150);
    expect(done).toBe(false);
    expect(await current()).toBe('main');
    release();
    await holder;
    expect((await pending).status).toBe(200);
    expect(await current()).toBe('feature');
  });
});
