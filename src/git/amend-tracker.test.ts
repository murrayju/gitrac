import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { AmendTracker } from './amend-tracker.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-amend-test-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  // Create initial commit
  await Bun.write(join(dir, 'README.md'), 'hello');
  await git.add('.');
  await git.commit('initial');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('AmendTracker', () => {
  test('record and canAmend returns true for matching state', async () => {
    const tracker = new AmendTracker();
    const git = simpleGit(dir);

    // Create a commit to track
    await Bun.write(join(dir, 'issue.md'), '# Issue');
    await git.add('.');
    const result = await git.commit('add issue');
    const hash = result.commit;

    tracker.record(1, hash);
    expect(await tracker.canAmend(dir, 1)).toBe(true);
  });

  test('canAmend returns false for different issue id', async () => {
    const tracker = new AmendTracker();
    const git = simpleGit(dir);

    await Bun.write(join(dir, 'issue.md'), '# Issue');
    await git.add('.');
    const result = await git.commit('add issue');

    tracker.record(1, result.commit);
    expect(await tracker.canAmend(dir, 2)).toBe(false);
  });

  test('canAmend returns false after HEAD changes', async () => {
    const tracker = new AmendTracker();
    const git = simpleGit(dir);

    await Bun.write(join(dir, 'issue.md'), '# Issue');
    await git.add('.');
    const result = await git.commit('add issue');

    tracker.record(1, result.commit);

    // Make another commit, changing HEAD
    await Bun.write(join(dir, 'other.md'), '# Other');
    await git.add('.');
    await git.commit('add other');

    expect(await tracker.canAmend(dir, 1)).toBe(false);
  });

  test('clear resets state', async () => {
    const tracker = new AmendTracker();
    const git = simpleGit(dir);

    await Bun.write(join(dir, 'issue.md'), '# Issue');
    await git.add('.');
    const result = await git.commit('add issue');

    tracker.record(1, result.commit);
    tracker.clear();
    expect(await tracker.canAmend(dir, 1)).toBe(false);
  });

  test('amend modifies HEAD commit', async () => {
    const tracker = new AmendTracker();
    const git = simpleGit(dir);

    await Bun.write(join(dir, 'issue.md'), '# Issue v1');
    await git.add('.');
    await git.commit('add issue');

    // Now amend with updated file
    await Bun.write(join(dir, 'issue.md'), '# Issue v2');
    const newHash = await tracker.amend(dir, ['issue.md'], 'update issue');

    expect(typeof newHash).toBe('string');
    expect(newHash.length).toBeGreaterThan(0);

    // Verify only 2 commits total (initial + amended)
    const log = await git.log();
    expect(log.total).toBe(2);
    expect(log.latest?.message).toBe('update issue');
  });

  test('canAmend returns false when no state recorded', async () => {
    const tracker = new AmendTracker();
    expect(await tracker.canAmend(dir, 1)).toBe(false);
  });
});
