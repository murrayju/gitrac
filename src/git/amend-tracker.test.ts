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

  describe('commitOrAmend', () => {
    test('first call creates a new commit', async () => {
      const tracker = new AmendTracker();
      const git = simpleGit(dir);

      await Bun.write(join(dir, 'issue.md'), '# Issue v1');
      await tracker.commitOrAmend(dir, 1, ['issue.md'], 'add issue');

      const log = await git.log();
      expect(log.total).toBe(2); // initial + add issue
      expect(log.latest?.message).toBe('add issue');
    });

    test('second call for same issue amends the commit', async () => {
      const tracker = new AmendTracker();
      const git = simpleGit(dir);

      await Bun.write(join(dir, 'issue.md'), '# Issue v1');
      await tracker.commitOrAmend(dir, 1, ['issue.md'], 'add issue');

      await Bun.write(join(dir, 'issue.md'), '# Issue v2');
      await tracker.commitOrAmend(dir, 1, ['issue.md'], 'update issue');

      const log = await git.log();
      expect(log.total).toBe(2); // initial + amended (not 3)
      expect(log.latest?.message).toBe('update issue');
    });

    test('third call still amends for same issue', async () => {
      const tracker = new AmendTracker();
      const git = simpleGit(dir);

      await Bun.write(join(dir, 'issue.md'), '# Issue v1');
      await tracker.commitOrAmend(dir, 1, ['issue.md'], 'comment on issue');

      await Bun.write(join(dir, 'issue.md'), '# Issue v2');
      await tracker.commitOrAmend(dir, 1, ['issue.md'], 'delete comment');

      await Bun.write(join(dir, 'issue.md'), '# Issue v3');
      await tracker.commitOrAmend(dir, 1, ['issue.md'], 'another comment');

      const log = await git.log();
      expect(log.total).toBe(2); // initial + one amended commit
      expect(log.latest?.message).toBe('another comment');
    });

    test('call for different issue creates a new commit', async () => {
      const tracker = new AmendTracker();
      const git = simpleGit(dir);

      await Bun.write(join(dir, 'issue1.md'), '# Issue 1');
      await tracker.commitOrAmend(dir, 1, ['issue1.md'], 'add issue 1');

      await Bun.write(join(dir, 'issue2.md'), '# Issue 2');
      await tracker.commitOrAmend(dir, 2, ['issue2.md'], 'add issue 2');

      const log = await git.log();
      expect(log.total).toBe(3); // initial + issue 1 + issue 2
    });
  });

  describe('dropIfNoOp', () => {
    // Helper: set up repo with an issue file committed as the "base" state.
    // Returns the base version string.
    async function setupIssueBase(git: ReturnType<typeof simpleGit>) {
      const base = [
        '---',
        'id: 1',
        'title: Test Issue',
        'updated: 2026-03-28T12:00:00.000Z',
        '---',
        '',
        'Description here.',
      ].join('\n');
      await Bun.write(join(dir, 'issue.md'), base);
      await git.add('.');
      await git.commit('add issue');
      return base;
    }

    test('drops commit when only updated: timestamp changed', async () => {
      const tracker = new AmendTracker();
      const git = simpleGit(dir);

      const base = await setupIssueBase(git);

      // Simulate a web edit: change title (creates a new commit)
      const v2 = base
        .replace('title: Test Issue', 'title: Changed Title')
        .replace(
          'updated: 2026-03-28T12:00:00.000Z',
          'updated: 2026-03-28T13:00:00.000Z',
        );
      await Bun.write(join(dir, 'issue.md'), v2);
      await git.add('.');
      const editCommit = await git.commit('edit issue');
      tracker.record(1, editCommit.commit);

      // User reverts the title, but timestamp changes again
      const v3 = base.replace(
        'updated: 2026-03-28T12:00:00.000Z',
        'updated: 2026-03-28T14:30:00.000Z',
      );
      await Bun.write(join(dir, 'issue.md'), v3);
      await tracker.amend(dir, ['issue.md'], 'update issue');

      const dropped = await tracker.dropIfNoOp(dir);
      expect(dropped).toBe(true);

      // Commit should be gone — back to initial + add issue
      const logAfter = await git.log();
      expect(logAfter.total).toBe(2);
      expect(logAfter.latest?.message).toBe('add issue');
    });

    test('does NOT drop commit with real content changes', async () => {
      const tracker = new AmendTracker();
      const git = simpleGit(dir);

      const base = await setupIssueBase(git);

      // Simulate a web edit with a real change
      const v2 = base
        .replace('Description here.', 'Updated description.')
        .replace(
          'updated: 2026-03-28T12:00:00.000Z',
          'updated: 2026-03-28T14:30:00.000Z',
        );
      await Bun.write(join(dir, 'issue.md'), v2);
      await git.add('.');
      const editCommit = await git.commit('edit issue');
      tracker.record(1, editCommit.commit);

      // Amend (timestamp changes again but content change persists)
      const v3 = v2.replace(
        'updated: 2026-03-28T14:30:00.000Z',
        'updated: 2026-03-28T15:00:00.000Z',
      );
      await Bun.write(join(dir, 'issue.md'), v3);
      await tracker.amend(dir, ['issue.md'], 'update issue');

      const dropped = await tracker.dropIfNoOp(dir);
      expect(dropped).toBe(false);

      // Commit should still be there
      const log = await git.log();
      expect(log.total).toBe(3);
      expect(log.latest?.message).toBe('update issue');
    });

    test('clears tracker state after dropping', async () => {
      const tracker = new AmendTracker();
      const git = simpleGit(dir);

      const base = await setupIssueBase(git);

      // Create an edit commit, then revert everything except timestamp
      const v2 = base
        .replace('title: Test Issue', 'title: Changed Title')
        .replace(
          'updated: 2026-03-28T12:00:00.000Z',
          'updated: 2026-03-28T13:00:00.000Z',
        );
      await Bun.write(join(dir, 'issue.md'), v2);
      await git.add('.');
      const editCommit = await git.commit('edit issue');
      tracker.record(1, editCommit.commit);

      const v3 = base.replace(
        'updated: 2026-03-28T12:00:00.000Z',
        'updated: 2026-03-28T14:30:00.000Z',
      );
      await Bun.write(join(dir, 'issue.md'), v3);
      await tracker.amend(dir, ['issue.md'], 'update issue');

      await tracker.dropIfNoOp(dir);

      // Tracker state should be cleared — canAmend should return false
      expect(await tracker.canAmend(dir, 1)).toBe(false);
    });

    test('working tree is clean after dropping', async () => {
      const tracker = new AmendTracker();
      const git = simpleGit(dir);

      const base = await setupIssueBase(git);

      // Create edit commit, then revert to only-timestamp diff
      const v2 = base
        .replace('title: Test Issue', 'title: Changed Title')
        .replace(
          'updated: 2026-03-28T12:00:00.000Z',
          'updated: 2026-03-28T13:00:00.000Z',
        );
      await Bun.write(join(dir, 'issue.md'), v2);
      await git.add('.');
      const editCommit = await git.commit('edit issue');
      tracker.record(1, editCommit.commit);

      const v3 = base.replace(
        'updated: 2026-03-28T12:00:00.000Z',
        'updated: 2026-03-28T14:30:00.000Z',
      );
      await Bun.write(join(dir, 'issue.md'), v3);
      await tracker.amend(dir, ['issue.md'], 'update issue');

      await tracker.dropIfNoOp(dir);

      // Working tree should be clean
      const status = await git.status();
      expect(status.isClean()).toBe(true);
    });
  });
});
