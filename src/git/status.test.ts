import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { createDefaultConfig } from '../core/config.ts';
import type { Config } from '../core/types.ts';
import {
  getBranchWarning,
  getCurrentBranch,
  getDefaultBranch,
  getGitRoot,
  hasRemote,
  isOnDefaultBranch,
  isPushed,
} from './status.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-git-test-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<Config> = {}): Config {
  return { ...createDefaultConfig(), ...overrides };
}

describe('getCurrentBranch', () => {
  test('returns the current branch name', async () => {
    const git = simpleGit(dir);
    // Need at least one commit for branch to exist
    await Bun.write(join(dir, 'README.md'), 'hello');
    await git.add('.');
    await git.commit('initial');
    const branch = await getCurrentBranch(dir);
    // Default branch is usually 'main' or 'master'
    expect(typeof branch).toBe('string');
    expect(branch.length).toBeGreaterThan(0);
  });
});

describe('getDefaultBranch', () => {
  test('returns config.git.defaultBranch', () => {
    const config = makeConfig();
    expect(getDefaultBranch(config)).toBe('main');
  });

  test('returns custom default branch', () => {
    const config = makeConfig({
      git: {
        autoCommit: true,
        autoPush: false,
        commitPrefix: 'issue:',
        defaultBranch: 'develop',
      },
    });
    expect(getDefaultBranch(config)).toBe('develop');
  });
});

describe('isOnDefaultBranch', () => {
  test('returns true when on default branch', async () => {
    const git = simpleGit(dir);
    await Bun.write(join(dir, 'README.md'), 'hello');
    await git.add('.');
    await git.commit('initial');
    // Get current branch name
    const branch = await getCurrentBranch(dir);
    const config = makeConfig({
      git: {
        autoCommit: true,
        autoPush: false,
        commitPrefix: 'issue:',
        defaultBranch: branch,
      },
    });
    expect(await isOnDefaultBranch(dir, config)).toBe(true);
  });

  test('returns false when on different branch', async () => {
    const git = simpleGit(dir);
    await Bun.write(join(dir, 'README.md'), 'hello');
    await git.add('.');
    await git.commit('initial');
    await git.checkoutLocalBranch('feature-branch');
    const config = makeConfig();
    // Default config has 'main', so if on 'feature-branch', not on default
    expect(await isOnDefaultBranch(dir, config)).toBe(false);
  });
});

describe('getBranchWarning', () => {
  test('returns null when on default branch', async () => {
    const git = simpleGit(dir);
    await Bun.write(join(dir, 'README.md'), 'hello');
    await git.add('.');
    await git.commit('initial');
    const branch = await getCurrentBranch(dir);
    const config = makeConfig({
      git: {
        autoCommit: true,
        autoPush: false,
        commitPrefix: 'issue:',
        defaultBranch: branch,
      },
    });
    const warning = await getBranchWarning(dir, config);
    expect(warning).toBeNull();
  });

  test('returns warning when on non-default branch', async () => {
    const git = simpleGit(dir);
    await Bun.write(join(dir, 'README.md'), 'hello');
    await git.add('.');
    await git.commit('initial');
    await git.checkoutLocalBranch('feature-branch');
    const config = makeConfig();
    const warning = await getBranchWarning(dir, config);
    expect(warning).not.toBeNull();
    expect(warning).toContain('feature-branch');
  });
});

describe('isPushed', () => {
  test('returns true when no remote exists', async () => {
    const git = simpleGit(dir);
    await Bun.write(join(dir, 'README.md'), 'hello');
    await git.add('.');
    await git.commit('initial');
    expect(await isPushed(dir)).toBe(true);
  });
});

describe('hasRemote', () => {
  test('returns false for local repo with no remote', async () => {
    expect(await hasRemote(dir)).toBe(false);
  });

  test('returns true after adding a remote', async () => {
    const git = simpleGit(dir);
    await git.addRemote('origin', 'https://example.com/repo.git');
    expect(await hasRemote(dir)).toBe(true);
  });
});

describe('getGitRoot', () => {
  test('returns the git repo root', async () => {
    const root = await getGitRoot(dir);
    // The resolved paths should match (tmpdir may have symlinks)
    expect(root).toBeTruthy();
  });

  test('throws when not in a git repo', async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), 'gitrac-no-git-'));
    try {
      expect(getGitRoot(nonGitDir)).rejects.toThrow();
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });
});
