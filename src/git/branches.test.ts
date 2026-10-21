import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import type { GitracError } from '../core/errors.ts';
import {
  type BranchRepo,
  branchRepo,
  startConflictingMerge,
} from './branches.fixture.ts';
import {
  dirtyTrackedPaths,
  gitSwitch,
  operationInProgress,
  readBranchState,
} from './branches.ts';

let repo: BranchRepo;
let base: string;
let dir: string;

beforeEach(async () => {
  repo = await branchRepo();
  ({ base, dir } = repo);
});

afterEach(async () => {
  await repo.cleanup();
});

async function rejection(promise: Promise<unknown>): Promise<GitracError> {
  try {
    await promise;
  } catch (err) {
    return err as GitracError;
  }
  throw new Error('expected a rejection');
}

describe('readBranchState', () => {
  test('lists local branches with the current one marked', async () => {
    const state = await readBranchState(dir);
    expect(state.current).toBe('main');
    expect(state.detached).toBe(false);
    expect(state.head).toMatch(/^[0-9a-f]{4,}$/);
    expect(state.branches).toEqual([
      { name: 'feature', current: false },
      { name: 'main', current: true },
      { name: 'plain', current: false, uninitialized: true },
    ]);
    expect(state.dirty).toBe(false);
    expect(state.operation).toBeNull();
  });

  test('marks a branch checked out in another worktree', async () => {
    const wt = join(base, 'wt');
    await simpleGit(dir).raw(['worktree', 'add', '-q', wt, 'feature']);
    const state = await readBranchState(dir);
    expect(state.branches.find((b) => b.name === 'feature')).toEqual({
      name: 'feature',
      current: false,
      worktree: wt,
    });
    // Seen from the other worktree, main is the one elsewhere.
    const there = await readBranchState(wt);
    expect(there.current).toBe('feature');
    expect(there.branches.find((b) => b.name === 'main')?.worktree).toBe(dir);
  });

  test('a detached HEAD', async () => {
    await simpleGit(dir).raw(['switch', '-q', '--detach']);
    const state = await readBranchState(dir);
    expect(state.current).toBeNull();
    expect(state.detached).toBe(true);
    expect(state.branches.every((b) => !b.current)).toBe(true);
  });

  test('modified and staged tracked files are dirty; untracked are not', async () => {
    await writeFile(join(dir, 'untracked.txt'), 'new\n');
    expect((await readBranchState(dir)).dirty).toBe(false);
    await writeFile(join(dir, 'README.md'), 'changed\n');
    await writeFile(join(dir, 'staged.txt'), 'staged\n');
    await simpleGit(dir).add('staged.txt');
    const state = await readBranchState(dir);
    expect(state.dirty).toBe(true);
    expect(state.dirtyCount).toBe(2);
    expect(state.dirtyPaths.sort()).toEqual(['README.md', 'staged.txt']);
    expect(await dirtyTrackedPaths(dir)).toHaveLength(2);
  });

  test('a merge in progress', async () => {
    await startConflictingMerge(dir);
    expect(await operationInProgress(dir)).toBe('merge');
    expect((await readBranchState(dir)).operation).toBe('merge');
  });

  test('no operation outside one', async () => {
    expect(await operationInProgress(dir)).toBeNull();
  });
});

describe('gitSwitch', () => {
  test('switches to a local branch', async () => {
    await gitSwitch(dir, 'feature');
    expect((await readBranchState(dir)).current).toBe('feature');
    expect(await Bun.file(join(dir, 'README.md')).text()).toBe('feature\n');
  });

  test('surfaces git refusing to overwrite an untracked file', async () => {
    await writeFile(join(dir, 'other.txt'), 'mine\n');
    // `plain` tracks other.txt; git refuses to overwrite the untracked copy.
    const err = await rejection(gitSwitch(dir, 'plain'));
    expect(err.code).toBe('git_error');
    expect(err.message).toContain('git switch failed');
    expect(err.message).toContain('other.txt');
    expect(await Bun.file(join(dir, 'other.txt')).text()).toBe('mine\n');
  });

  test('never guesses a branch from a remote-tracking one', async () => {
    const git = simpleGit(dir);
    await git.raw(['update-ref', 'refs/remotes/origin/remote-only', 'HEAD']);
    const err = await rejection(gitSwitch(dir, 'remote-only'));
    expect(err.code).toBe('git_error');
    expect((await readBranchState(dir)).current).toBe('main');
  });
});
