import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { isLockHeld } from '../fs/lock.ts';
import { REPO_LOCK_NAME, repoLockPath, withRepoLock } from './lock.ts';

let dir: string;
let worktree: string | null;

beforeEach(async () => {
  worktree = null;
  dir = await realpath(await mkdtemp(join(tmpdir(), 'gitrac-repolock-')));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await Bun.write(join(dir, 'README.md'), 'hello');
  await git.add('.');
  await git.commit('initial');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  if (worktree) await rm(worktree, { recursive: true, force: true });
});

describe('repoLockPath', () => {
  test('is gitrac.lock inside the git common dir', async () => {
    expect(await repoLockPath(dir)).toBe(join(dir, '.git', REPO_LOCK_NAME));
  });

  test('is the same from a subdirectory', async () => {
    const sub = join(dir, 'a', 'b');
    await mkdir(sub, { recursive: true });
    expect(await repoLockPath(sub)).toBe(join(dir, '.git', REPO_LOCK_NAME));
  });

  test('is shared by linked worktrees', async () => {
    worktree = join(
      await realpath(await mkdtemp(join(tmpdir(), 'gitrac-wt-'))),
      'wt',
    );
    await simpleGit(dir).raw(['worktree', 'add', '-b', 'other', worktree]);
    expect(await repoLockPath(worktree)).toBe(
      join(dir, '.git', REPO_LOCK_NAME),
    );
  });

  test('falls back to a per-directory temp lock outside git', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'gitrac-plain-'));
    try {
      const a = await repoLockPath(plain);
      expect(a.startsWith(tmpdir())).toBe(true);
      expect(await repoLockPath(plain)).toBe(a);
      expect(await repoLockPath(dir)).not.toBe(a);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe('withRepoLock', () => {
  test('holds the repo lockfile while running', async () => {
    const path = await repoLockPath(dir);
    await withRepoLock(dir, async () => {
      expect(isLockHeld(path)).toBe(true);
      expect(await Bun.file(path).exists()).toBe(true);
    });
    expect(await Bun.file(path).exists()).toBe(false);
  });
});
