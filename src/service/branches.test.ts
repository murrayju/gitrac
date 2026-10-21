import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import type { GitracError } from '../core/errors.ts';
import {
  type BranchRepo,
  branchRepo,
  startConflictingMerge,
} from '../git/branches.fixture.ts';
import { readBranchState } from '../git/branches.ts';
import { withRepoLock } from '../git/lock.ts';
import { switchBranch } from './branches.ts';

let repo: BranchRepo;
let dir: string;

beforeEach(async () => {
  repo = await branchRepo();
  dir = repo.dir;
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
  throw new Error('expected the switch to fail');
}

async function current(): Promise<string | null> {
  return (await readBranchState(dir)).current;
}

describe('switchBranch', () => {
  test('clean switch', async () => {
    const result = await switchBranch({ dir }, 'feature');
    expect(result.switched).toBe(true);
    expect(result.previous).toBe('main');
    expect(result.state.current).toBe('feature');
    expect(await current()).toBe('feature');
  });

  test('the current branch is a no-op', async () => {
    const result = await switchBranch({ dir }, 'main');
    expect(result.switched).toBe(false);
    expect(result.state.current).toBe('main');
  });

  test('modified tracked files are refused and kept', async () => {
    await writeFile(join(dir, 'README.md'), 'local edit\n');
    const err = await rejection(switchBranch({ dir }, 'feature'));
    expect(err.code).toBe('invalid_state');
    expect(err.message).toContain('README.md');
    expect(await current()).toBe('main');
    expect(await Bun.file(join(dir, 'README.md')).text()).toBe('local edit\n');
  });

  test('staged changes are refused', async () => {
    await writeFile(join(dir, 'new.txt'), 'x\n');
    await simpleGit(dir).add('new.txt');
    const err = await rejection(switchBranch({ dir }, 'feature'));
    expect(err.code).toBe('invalid_state');
    expect(err.details).toEqual({ paths: ['new.txt'] });
  });

  test('untracked files are fine and survive the switch', async () => {
    await writeFile(join(dir, 'notes.txt'), 'mine\n');
    await switchBranch({ dir }, 'feature');
    expect(await current()).toBe('feature');
    expect(await Bun.file(join(dir, 'notes.txt')).text()).toBe('mine\n');
  });

  test('git refusing to overwrite an untracked file is a git_error', async () => {
    // A gitrac branch that tracks other.txt; main does not.
    const git = simpleGit(dir);
    await git.raw(['switch', '-q', '-c', 'tracks-other']);
    await writeFile(join(dir, 'other.txt'), 'theirs\n');
    await git.add('other.txt');
    await git.commit('add other.txt');
    await git.raw(['switch', '-q', 'main']);
    await writeFile(join(dir, 'other.txt'), 'mine\n');
    const err = await rejection(switchBranch({ dir }, 'tracks-other'));
    expect(err.code).toBe('git_error');
    expect(err.message).toContain('other.txt');
    expect(await current()).toBe('main');
    expect(await Bun.file(join(dir, 'other.txt')).text()).toBe('mine\n');
  });

  test('a branch checked out in another worktree is refused', async () => {
    const wt = join(repo.base, 'wt');
    await simpleGit(dir).raw(['worktree', 'add', '-q', wt, 'feature']);
    const err = await rejection(switchBranch({ dir }, 'feature'));
    expect(err.code).toBe('invalid_state');
    expect(err.message).toBe(
      `Branch "feature" is checked out in worktree ${wt}.`,
    );
    expect(await current()).toBe('main');
  });

  test('a branch without gitrac is refused', async () => {
    const err = await rejection(switchBranch({ dir }, 'plain'));
    expect(err.code).toBe('invalid_state');
    expect(err.message).toContain('no .issues/config.yaml');
  });

  test('unknown and option-like names are invalid input', async () => {
    for (const name of ['nope', '--orphan', '-', '', 42, undefined]) {
      const err = await rejection(switchBranch({ dir }, name));
      expect(err.code).toBe('invalid_input');
    }
    expect(await current()).toBe('main');
  });

  test('remote-tracking branches are not local branches', async () => {
    await simpleGit(dir).raw([
      'update-ref',
      'refs/remotes/origin/remote-only',
      'HEAD',
    ]);
    for (const name of ['remote-only', 'origin/remote-only']) {
      const err = await rejection(switchBranch({ dir }, name));
      expect(err.code).toBe('invalid_input');
    }
  });

  test('a merge in progress is refused', async () => {
    await startConflictingMerge(dir);
    const err = await rejection(switchBranch({ dir }, 'feature'));
    expect(err.code).toBe('invalid_state');
    expect(err.message).toContain('A merge is in progress');
    expect(err.details).toEqual({ operation: 'merge' });
  });

  test('from a detached HEAD', async () => {
    await simpleGit(dir).raw(['switch', '-q', '--detach']);
    const result = await switchBranch({ dir }, 'feature');
    expect(result.previous).toBeNull();
    expect(result.state.current).toBe('feature');
  });

  test('waits for the repo lock', async () => {
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
    const pending = switchBranch({ dir }, 'feature').then(() => {
      done = true;
    });
    await Bun.sleep(150);
    expect(done).toBe(false);
    expect(await current()).toBe('main');
    release();
    await holder;
    await pending;
    expect(await current()).toBe('feature');
  });
});
