import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { createDefaultConfig } from '../core/config.ts';
import type { Config } from '../core/types.ts';
import {
  commitIssueChange,
  pullRebase,
  pushIfConfigured,
} from './operations.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-ops-test-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  // Create initial commit so HEAD exists
  await Bun.write(join(dir, 'README.md'), 'hello');
  await git.add('.');
  await git.commit('initial');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<Config> = {}): Config {
  return { ...createDefaultConfig(), ...overrides };
}

describe('commitIssueChange', () => {
  test('stages files and commits, returns hash', async () => {
    await Bun.write(join(dir, 'issue.md'), '# Issue');
    const hash = await commitIssueChange(dir, ['issue.md'], 'add issue');
    expect(hash).not.toBeNull();
    expect(typeof hash).toBe('string');
    expect(hash?.length).toBeGreaterThan(0);

    // Verify commit happened
    const git = simpleGit(dir);
    const log = await git.log();
    expect(log.latest?.message).toBe('add issue');
  });

  test('returns null when noCommit is true', async () => {
    await Bun.write(join(dir, 'issue.md'), '# Issue');
    const hash = await commitIssueChange(dir, ['issue.md'], 'add issue', {
      noCommit: true,
    });
    expect(hash).toBeNull();

    // Verify no new commit
    const git = simpleGit(dir);
    const log = await git.log();
    expect(log.latest?.message).toBe('initial');
  });

  test('stages multiple files', async () => {
    await Bun.write(join(dir, 'a.md'), 'a');
    await Bun.write(join(dir, 'b.md'), 'b');
    const hash = await commitIssueChange(dir, ['a.md', 'b.md'], 'add both');
    expect(hash).not.toBeNull();

    const git = simpleGit(dir);
    const show = await git.show(['--stat', '--format=%s', hash ?? '']);
    expect(show).toContain('a.md');
    expect(show).toContain('b.md');
  });

  describe('path-limited commits (regression #35)', () => {
    async function headFiles(): Promise<string[]> {
      const out = await simpleGit(dir).raw([
        'show',
        '--name-only',
        '--no-renames',
        '--format=',
        'HEAD',
      ]);
      return out.split('\n').filter(Boolean).sort();
    }

    async function stagedFiles(): Promise<string[]> {
      const out = await simpleGit(dir).diff(['--cached', '--name-only']);
      return out.split('\n').filter(Boolean).sort();
    }

    test('does not include unrelated staged changes', async () => {
      const git = simpleGit(dir);
      await Bun.write(join(dir, 'code.txt'), 'secret');
      await git.add('code.txt');
      await Bun.write(join(dir, 'README.md'), 'staged edit');
      await git.add('README.md');

      await Bun.write(join(dir, 'issue.md'), '# Issue');
      const hash = await commitIssueChange(dir, ['issue.md'], 'add issue');
      expect(hash).not.toBeNull();

      expect(await headFiles()).toEqual(['issue.md']);
      // Pre-existing staged changes remain staged and uncommitted
      expect(await stagedFiles()).toEqual(['README.md', 'code.txt']);
      expect(await Bun.file(join(dir, 'code.txt')).text()).toBe('secret');
      expect(await git.show(['HEAD:README.md'])).toBe('hello');
    });

    test('handles a rename (old path deleted on disk)', async () => {
      const git = simpleGit(dir);
      await Bun.write(join(dir, '.issues/1-old.md'), '# Issue');
      await commitIssueChange(dir, ['.issues/1-old.md'], 'create');

      await Bun.write(join(dir, 'code.txt'), 'secret');
      await git.add('code.txt');

      // Simulate close: move into closed/ (old file removed from disk only)
      await Bun.write(join(dir, '.issues/closed/1-old.md'), '# Issue');
      await rm(join(dir, '.issues/1-old.md'));
      const hash = await commitIssueChange(
        dir,
        ['.issues/1-old.md', '.issues/closed/1-old.md'],
        'close',
      );
      expect(hash).not.toBeNull();

      expect(await headFiles()).toEqual([
        '.issues/1-old.md',
        '.issues/closed/1-old.md',
      ]);
      const tree = await git.raw(['ls-tree', '-r', '--name-only', 'HEAD']);
      expect(tree).not.toContain('.issues/1-old.md\n');
      expect(tree).toContain('.issues/closed/1-old.md');
      expect(await stagedFiles()).toEqual(['code.txt']);
      const status = await git.status();
      expect(status.not_added).toEqual([]);
      expect(status.deleted).toEqual([]);
    });

    test('handles a deletion already staged via git rm', async () => {
      const git = simpleGit(dir);
      await Bun.write(join(dir, 'a.md'), 'a');
      await commitIssueChange(dir, ['a.md'], 'create');
      await git.rm(['a.md']);
      await Bun.write(join(dir, 'code.txt'), 'secret');
      await git.add('code.txt');

      await Bun.write(join(dir, 'b.md'), 'a');
      await commitIssueChange(dir, ['a.md', 'b.md'], 'rename');

      expect(await headFiles()).toEqual(['a.md', 'b.md']);
      expect(await stagedFiles()).toEqual(['code.txt']);
    });

    test('ignores paths unknown to git that do not exist', async () => {
      const git = simpleGit(dir);
      await Bun.write(join(dir, 'code.txt'), 'secret');
      await git.add('code.txt');

      await Bun.write(join(dir, 'issue.md'), '# Issue');
      const hash = await commitIssueChange(
        dir,
        ['issue.md', 'never-existed.md'],
        'add issue',
      );
      expect(hash).not.toBeNull();
      expect(await headFiles()).toEqual(['issue.md']);
      expect(await stagedFiles()).toEqual(['code.txt']);
    });

    test('does not commit the index when no listed path has changes', async () => {
      const git = simpleGit(dir);
      await Bun.write(join(dir, 'code.txt'), 'secret');
      await git.add('code.txt');

      expect(await commitIssueChange(dir, ['README.md'], 'nothing')).toBeNull();
      expect(await commitIssueChange(dir, ['missing.md'], 'none')).toBeNull();
      expect(await commitIssueChange(dir, [], 'empty')).toBeNull();

      const log = await git.log();
      expect(log.latest?.message).toBe('initial');
      expect(await stagedFiles()).toEqual(['code.txt']);
    });

    test('handles paths with glob characters literally', async () => {
      const git = simpleGit(dir);
      await Bun.write(join(dir, 'a*.md'), 'glob');
      await Bun.write(join(dir, 'ab.md'), 'other');
      await commitIssueChange(dir, ['a*.md'], 'literal');
      expect(await headFiles()).toEqual(['a*.md']);
      const status = await git.status();
      expect(status.not_added).toEqual(['ab.md']);
    });

    test('works for the root commit of an empty repo', async () => {
      const fresh = await mkdtemp(join(tmpdir(), 'gitrac-ops-root-'));
      try {
        const git = simpleGit(fresh);
        await git.init();
        await git.addConfig('user.email', 'test@test.com');
        await git.addConfig('user.name', 'Test');
        await Bun.write(join(fresh, 'code.txt'), 'secret');
        await git.add('code.txt');
        await Bun.write(join(fresh, '.issues/config.yaml'), 'x: 1\n');

        const hash = await commitIssueChange(
          fresh,
          ['.issues/config.yaml'],
          'init',
        );
        expect(hash).not.toBeNull();
        const files = await git.raw([
          'show',
          '--name-only',
          '--format=',
          'HEAD',
        ]);
        expect(files.trim()).toBe('.issues/config.yaml');
        const staged = await git.diff(['--cached', '--name-only']);
        expect(staged.trim()).toBe('code.txt');
      } finally {
        await rm(fresh, { recursive: true, force: true });
      }
    });
  });
});

describe('pushIfConfigured', () => {
  test('does nothing when no remote exists', async () => {
    const config = makeConfig({
      git: {
        autoCommit: true,
        autoPush: true,
        commitPrefix: 'issue:',
        defaultBranch: 'main',
      },
    });
    // Should not throw
    await pushIfConfigured(dir, config, {});
  });

  test('does nothing when noPush flag is set', async () => {
    const config = makeConfig({
      git: {
        autoCommit: true,
        autoPush: true,
        commitPrefix: 'issue:',
        defaultBranch: 'main',
      },
    });
    // noPush flag overrides config
    await pushIfConfigured(dir, config, { noPush: true });
  });

  test('does nothing when autoPush is false and no push flag', async () => {
    const config = makeConfig();
    // Default autoPush is false, no push flag
    await pushIfConfigured(dir, config, {});
  });
});

describe('pullRebase', () => {
  test('no-op when no remote exists', async () => {
    // Should not throw
    await pullRebase(dir);
  });
});
