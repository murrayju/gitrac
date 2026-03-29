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
