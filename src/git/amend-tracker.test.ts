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

  test('amend does not include unrelated staged changes (regression #35)', async () => {
    const tracker = new AmendTracker();
    const git = simpleGit(dir);

    await Bun.write(join(dir, 'issue.md'), '# Issue v1');
    await tracker.commitOrAmend(dir, 1, ['issue.md'], 'add issue');

    // User stages unrelated work between web edits
    await Bun.write(join(dir, 'code.txt'), 'secret');
    await git.add('code.txt');
    await Bun.write(join(dir, 'README.md'), 'staged edit');
    await git.add('README.md');

    await Bun.write(join(dir, 'issue.md'), '# Issue v2');
    await tracker.amend(dir, ['issue.md'], 'update issue');

    const log = await git.log();
    expect(log.total).toBe(2);
    const files = await git.raw(['show', '--name-only', '--format=', 'HEAD']);
    expect(files.trim()).toBe('issue.md');
    expect(await git.show(['HEAD:issue.md'])).toBe('# Issue v2');
    expect(await git.show(['HEAD:README.md'])).toBe('hello');
    const staged = await git.diff(['--cached', '--name-only']);
    expect(staged.split('\n').filter(Boolean).sort()).toEqual([
      'README.md',
      'code.txt',
    ]);
  });

  test('amend handles a rename where the old path was created by the amended commit', async () => {
    const tracker = new AmendTracker();
    const git = simpleGit(dir);

    await Bun.write(join(dir, '1-old.md'), '# Old');
    await tracker.commitOrAmend(dir, 1, ['1-old.md'], 'add issue');

    await Bun.write(join(dir, 'code.txt'), 'secret');
    await git.add('code.txt');

    // Title change: new filename written, old one deleted from disk
    await Bun.write(join(dir, '1-new.md'), '# New');
    await rm(join(dir, '1-old.md'));
    await tracker.commitOrAmend(dir, 1, ['1-new.md', '1-old.md'], 'rename');

    const log = await git.log();
    expect(log.total).toBe(2);
    const files = await git.raw(['show', '--name-only', '--format=', 'HEAD']);
    expect(files.trim()).toBe('1-new.md');
    const staged = await git.diff(['--cached', '--name-only']);
    expect(staged.trim()).toBe('code.txt');
    const status = await git.status();
    expect(status.deleted).toEqual([]);
    expect(status.not_added).toEqual([]);
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
    async function setupIssueBase(
      git: ReturnType<typeof simpleGit>,
      description = 'Description here.',
    ) {
      const base = [
        '---',
        'id: 1',
        'title: Test Issue',
        'updated: 2026-03-28T12:00:00.000Z',
        '---',
        '',
        description,
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

      const dropped = await tracker.dropIfNoOp(dir, ['issue.md']);
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

      const dropped = await tracker.dropIfNoOp(dir, ['issue.md']);
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

      await tracker.dropIfNoOp(dir, ['issue.md']);

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

      await tracker.dropIfNoOp(dir, ['issue.md']);

      // Working tree should be clean
      const status = await git.status();
      expect(status.isClean()).toBe(true);
    });

    // Helper: commit an edit to issue.md (tracked), then rewrite it so the
    // net change vs. the base is only the frontmatter `updated:` timestamp.
    async function editThenRevert(
      tracker: AmendTracker,
      git: ReturnType<typeof simpleGit>,
      base: string,
    ) {
      const v2 = base
        .replace('title: Test Issue', 'title: Changed Title')
        .replace(
          'updated: 2026-03-28T12:00:00.000Z',
          'updated: 2026-03-28T13:00:00.000Z',
        );
      await Bun.write(join(dir, 'issue.md'), v2);
      await git.add('issue.md');
      const editCommit = await git.commit('edit issue', ['issue.md']);
      tracker.record(1, editCommit.commit);
      const v3 = base.replace(
        'updated: 2026-03-28T12:00:00.000Z',
        'updated: 2026-03-28T14:30:00.000Z',
      );
      await Bun.write(join(dir, 'issue.md'), v3);
    }

    test('restores the issue file to the committed version after dropping', async () => {
      const tracker = new AmendTracker();
      const git = simpleGit(dir);
      const base = await setupIssueBase(git);
      await editThenRevert(tracker, git, base);
      await tracker.amend(dir, ['issue.md'], 'update issue');

      expect(await tracker.dropIfNoOp(dir, ['issue.md'])).toBe(true);
      expect(await Bun.file(join(dir, 'issue.md')).text()).toBe(base);
    });

    test('preserves unstaged changes to unrelated files (regression: reset --hard)', async () => {
      const tracker = new AmendTracker();
      const git = simpleGit(dir);
      const base = await setupIssueBase(git);

      // Unrelated tracked file with uncommitted work, plus an untracked file
      await Bun.write(join(dir, 'README.md'), 'uncommitted work');
      await Bun.write(join(dir, 'scratch.txt'), 'untracked work');

      await editThenRevert(tracker, git, base);
      // Real web flow: second edit amends, then detects the no-op and drops
      await tracker.commitOrAmend(dir, 1, ['issue.md'], 'update issue');

      const log = await git.log();
      expect(log.latest?.message).toBe('add issue');
      expect(await Bun.file(join(dir, 'README.md')).text()).toBe(
        'uncommitted work',
      );
      expect(await Bun.file(join(dir, 'scratch.txt')).text()).toBe(
        'untracked work',
      );
      const status = await git.status();
      expect(status.modified).toEqual(['README.md']);
      expect(status.staged).toEqual([]);
    });

    test('preserves staged changes to unrelated files', async () => {
      const tracker = new AmendTracker();
      const git = simpleGit(dir);
      const base = await setupIssueBase(git);
      await editThenRevert(tracker, git, base);
      await tracker.amend(dir, ['issue.md'], 'update issue');

      // Unrelated work staged by the user (not part of the gitrac commit)
      await Bun.write(join(dir, 'README.md'), 'staged work');
      await git.add('README.md');

      expect(await tracker.dropIfNoOp(dir, ['issue.md'])).toBe(true);

      expect(await Bun.file(join(dir, 'README.md')).text()).toBe('staged work');
      const status = await git.status();
      expect(status.staged).toEqual(['README.md']);
      expect(status.modified).toEqual(['README.md']);
      expect(await git.diff(['--cached', '--name-only'])).toBe('README.md\n');
    });

    test('does NOT drop when an `updated:` line changes in the description', async () => {
      const tracker = new AmendTracker();
      const git = simpleGit(dir);
      const base = await setupIssueBase(git, 'updated: before');
      await editThenRevert(tracker, git, base);

      // Net change: timestamp + an `updated:` line in the body
      const v3 = await Bun.file(join(dir, 'issue.md')).text();
      await Bun.write(
        join(dir, 'issue.md'),
        v3.replace('updated: before', 'updated: after'),
      );
      await tracker.amend(dir, ['issue.md'], 'update issue');

      expect(await tracker.dropIfNoOp(dir, ['issue.md'])).toBe(false);
      const log = await git.log();
      expect(log.latest?.message).toBe('update issue');
    });

    test('does NOT drop when the commit touches a file gitrac did not manage', async () => {
      const tracker = new AmendTracker();
      const git = simpleGit(dir);
      await Bun.write(join(dir, 'code.yaml'), 'updated: 1\n');
      await git.add('.');
      await git.commit('add code');
      const base = await setupIssueBase(git);
      await editThenRevert(tracker, git, base);

      // Unrelated file whose only change is an `updated:` line ends up in
      // the amended commit (e.g. someone amended it in outside gitrac;
      // tracker.amend itself only commits the paths it is given)
      await Bun.write(join(dir, 'code.yaml'), 'updated: 2\n');
      await git.add(['code.yaml', 'issue.md']);
      await git.commit('update issue', undefined, { '--amend': null });

      expect(await tracker.dropIfNoOp(dir, ['issue.md'])).toBe(false);
      const log = await git.log();
      expect(log.latest?.message).toBe('update issue');
      expect(await Bun.file(join(dir, 'code.yaml')).text()).toBe(
        'updated: 2\n',
      );
    });

    test('does NOT drop a root commit', async () => {
      const rootDir = await mkdtemp(join(tmpdir(), 'gitrac-amend-root-'));
      try {
        const git = simpleGit(rootDir);
        await git.init();
        await git.addConfig('user.email', 'test@test.com');
        await git.addConfig('user.name', 'Test');
        await Bun.write(join(rootDir, 'issue.md'), '---\nid: 1\n---\n');
        await git.add('.');
        await git.commit('root');
        const tracker = new AmendTracker();
        expect(await tracker.dropIfNoOp(rootDir, ['issue.md'])).toBe(false);
        expect((await git.log()).total).toBe(1);
      } finally {
        await rm(rootDir, { recursive: true, force: true });
      }
    });
  });
});
