import { afterEach, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseIssue, serializeIssue } from '../core/issue.ts';
import { type RemotesFixture, remotesFixture } from '../git/remotes.fixture.ts';
import type { ServiceContext } from './context.ts';
import {
  fetchRemotes,
  pullRemotes,
  pushRemotes,
  setSyncIncluded,
  syncRemotes,
  syncStatus,
} from './sync.ts';
import { makeIssue } from './test-helpers.fixture.ts';

let f: RemotesFixture;

afterEach(async () => {
  await f?.cleanup();
});

function ctx(dir = f.work): ServiceContext {
  return {
    dir,
    identity: async () => ({ name: 'Test', email: 'test@example.com' }),
  };
}

async function originLog(): Promise<string[]> {
  return (await f.git(f.origin, 'log', '--format=%s', 'main')).split('\n');
}

/** Push a commit from the peer clone to origin. */
async function peerCommit(path: string, content: string, message?: string) {
  await f.git(f.peer, 'pull', '-q', '--no-rebase');
  await f.commitFile(f.peer, path, content, message);
  await f.git(f.peer, 'push', '-q');
}

describe('syncStatus', () => {
  test('in sync after setup', async () => {
    f = await remotesFixture();
    const status = await syncStatus(f.work);
    expect(status.branch).toBe('main');
    expect(status.operation).toBeNull();
    expect(status.summary).toEqual({ state: 'in-sync', ahead: 0, behind: 0 });
    expect(status.remotes).toHaveLength(1);
    expect(status.remotes[0]).toMatchObject({
      name: 'origin',
      included: true,
      hasBranch: true,
      ahead: 0,
      behind: 0,
    });
  });

  test('ahead and behind come from local refs only (no network)', async () => {
    f = await remotesFixture();
    await f.commitFile(f.work, 'a', '1', 'local work');
    await peerCommit('b', '2', 'peer work');
    let status = await syncStatus(f.work);
    // Not fetched yet: only ahead.
    expect(status.summary).toEqual({
      state: 'out-of-sync',
      ahead: 1,
      behind: 0,
    });
    expect(status.remotes[0]?.toPush.commits.map((c) => c.subject)).toEqual([
      'local work',
    ]);
    await fetchRemotes(ctx());
    status = await syncStatus(f.work);
    expect(status.summary).toEqual({
      state: 'out-of-sync',
      ahead: 1,
      behind: 1,
    });
    expect(status.remotes[0]?.toPull.commits.map((c) => c.subject)).toEqual([
      'peer work',
    ]);
    expect(status.remotes[0]?.conflicts).toEqual([]);
    expect(status.remotes[0]?.lastFetch).toBeTruthy();
  });

  test('a remote without the branch is not published and lists all commits to push', async () => {
    f = await remotesFixture();
    await f.addRemote('backup');
    await setSyncIncluded(ctx(), 'origin', false);
    const status = await syncStatus(f.work);
    const backup = status.remotes.find((r) => r.name === 'backup');
    expect(backup).toMatchObject({ hasBranch: false, ahead: 1 });
    expect(status.summary.state).toBe('not-published');
  });

  test('a diverged remote with conflicts is a conflict state', async () => {
    f = await remotesFixture();
    await f.commitFile(f.work, 'README.md', 'ours\n');
    await peerCommit('README.md', 'theirs\n');
    await fetchRemotes(ctx());
    const status = await syncStatus(f.work);
    expect(status.summary.state).toBe('conflict');
    expect(status.remotes[0]?.conflicts).toEqual(['README.md']);
  });
});

describe('syncRemotes', () => {
  test('ahead: pushes', async () => {
    f = await remotesFixture();
    await f.commitFile(f.work, 'a', '1', 'local work');
    const result = await syncRemotes(ctx());
    expect(result.ok).toBe(true);
    expect(result.remotes).toEqual([
      {
        remote: 'origin',
        fetched: true,
        integrated: 'up-to-date',
        pushed: 'pushed',
      },
    ]);
    expect((await originLog())[0]).toBe('local work');
    expect((await syncStatus(f.work)).summary.state).toBe('in-sync');
  });

  test('behind: fast-forwards, no merge commit', async () => {
    f = await remotesFixture();
    await peerCommit('b', '2', 'peer work');
    const result = await syncRemotes(ctx());
    expect(result.remotes[0]).toMatchObject({
      integrated: 'fast-forward',
      pushed: 'up-to-date',
    });
    expect(await f.git(f.work, 'log', '-1', '--format=%s')).toBe('peer work');
  });

  test('diverged: merges (never rebases) and pushes the merge', async () => {
    f = await remotesFixture();
    const local = await f.commitFile(f.work, 'a', '1', 'local work');
    await peerCommit('b', '2', 'peer work');
    const result = await syncRemotes(ctx());
    expect(result.ok).toBe(true);
    expect(result.remotes[0]).toMatchObject({
      integrated: 'merge',
      pushed: 'pushed',
    });
    // The local commit keeps its hash (not rebased).
    expect(await f.git(f.work, 'rev-parse', 'HEAD^1')).toBe(local);
    expect((await originLog())[0]).toBe(
      "Merge remote-tracking branch 'origin/main'",
    );
  });

  test('diverged edits of one issue merge cleanly with the merge driver', async () => {
    f = await remotesFixture({ mergeDriver: true });
    const path = join('.issues', '1-shared.md');
    const issue = makeIssue({ title: 'Shared', description: 'one' });
    await f.commitFile(f.work, path, serializeIssue(issue), 'create #1');
    await f.git(f.work, 'push', '-q');
    await f.git(f.peer, 'pull', '-q');
    // Both sides change the same lines (frontmatter) of the issue.
    await f.commitFile(
      f.work,
      path,
      serializeIssue({
        ...issue,
        priority: 'high',
        updated: '2026-01-02T00:00:00Z',
        comments: [
          { author: 'a', timestamp: '2026-01-02T00:00:00Z', body: 'ours' },
        ],
      }),
      'ours',
    );
    await f.commitFile(
      f.peer,
      path,
      serializeIssue({
        ...issue,
        status: 'in_progress',
        updated: '2026-01-03T00:00:00Z',
        comments: [
          { author: 'b', timestamp: '2026-01-03T00:00:00Z', body: 'theirs' },
        ],
      }),
      'theirs',
    );
    await f.git(f.peer, 'push', '-q');

    await fetchRemotes(ctx());
    expect((await syncStatus(f.work)).remotes[0]?.conflicts).toEqual([]);
    const result = await syncRemotes(ctx());
    expect(result.ok).toBe(true);
    expect(result.remotes[0]).toMatchObject({
      integrated: 'merge',
      pushed: 'pushed',
    });
    const merged = parseIssue(await readFile(join(f.work, path), 'utf-8'));
    expect(merged.priority).toBe('high');
    expect(merged.status).toBe('in_progress');
    expect(merged.comments.map((c) => c.body)).toEqual(['ours', 'theirs']);
  });

  test('a conflict aborts the merge, keeps the tree and pushes nothing', async () => {
    f = await remotesFixture();
    const local = await f.commitFile(f.work, 'README.md', 'ours\n', 'ours');
    await peerCommit('README.md', 'theirs\n', 'theirs');
    const before = await originLog();
    const result = await syncRemotes(ctx());
    expect(result.ok).toBe(false);
    const outcome = result.remotes[0];
    expect(outcome?.error?.kind).toBe('conflict');
    expect(outcome?.error?.files).toEqual(['README.md']);
    expect(outcome?.error?.commands?.[0]).toBe(
      'git pull --no-rebase origin main',
    );
    expect(outcome?.pushed).toBeUndefined();
    expect(await f.git(f.work, 'rev-parse', 'HEAD')).toBe(local);
    expect(await f.git(f.work, 'status', '--porcelain')).toBe('');
    expect(await readFile(join(f.work, 'README.md'), 'utf-8')).toBe('ours\n');
    expect(await originLog()).toEqual(before);
    expect((await syncStatus(f.work)).summary.state).toBe('conflict');
  });

  test('uncommitted changes that the merge would overwrite are an error', async () => {
    f = await remotesFixture();
    await peerCommit('README.md', 'theirs\n');
    await writeFile(join(f.work, 'README.md'), 'dirty\n');
    const result = await syncRemotes(ctx());
    expect(result.remotes[0]?.error?.kind).toBe('local-changes');
    expect(result.remotes[0]?.error?.files).toEqual(['README.md']);
    expect(await readFile(join(f.work, 'README.md'), 'utf-8')).toBe('dirty\n');
  });

  test('skips remotes without the branch and excluded remotes', async () => {
    f = await remotesFixture();
    const backup = await f.addRemote('backup');
    const mirror = await f.addRemote('mirror');
    await setSyncIncluded(ctx(), 'mirror', false);
    await f.commitFile(f.work, 'a', '1', 'local work');
    const result = await syncRemotes(ctx());
    expect(result.ok).toBe(true);
    // The upstream remote comes first.
    expect(result.remotes.map((r) => r.remote)).toEqual(['origin', 'backup']);
    expect(result.remotes[1]).toEqual({
      remote: 'backup',
      fetched: true,
      skipped: 'no-branch',
    });
    expect(await f.git(backup, 'branch', '--list')).toBe('');
    expect(await f.git(mirror, 'branch', '--list')).toBe('');
  });

  test('syncs every included remote', async () => {
    f = await remotesFixture();
    const backup = await f.addRemote('backup');
    await pushRemotes(ctx(), { remote: 'backup' });
    await f.commitFile(f.work, 'a', '1', 'local work');
    const result = await syncRemotes(ctx());
    expect(result.ok).toBe(true);
    expect(result.remotes.map((r) => r.pushed)).toEqual(['pushed', 'pushed']);
    expect(await f.git(backup, 'log', '-1', '--format=%s', 'main')).toBe(
      'local work',
    );
  });

  test('remotes that share push URLs sync without racing (#124)', async () => {
    // Like a clone whose remotes each push to every server (several
    // `pushurl`s): `git push origin` and `git push backup` both reach both
    // bare repos. Parallel pushes made each server get the same push twice.
    f = await remotesFixture();
    const backup = await f.addRemote('backup');
    await pushRemotes(ctx(), { remote: 'backup' });
    for (const remote of ['origin', 'backup']) {
      await f
        .git(f.work, 'config', '--unset-all', `remote.${remote}.pushurl`)
        .catch(() => '');
      await f.git(
        f.work,
        'config',
        '--add',
        `remote.${remote}.pushurl`,
        f.origin,
      );
      await f.git(
        f.work,
        'config',
        '--add',
        `remote.${remote}.pushurl`,
        backup,
      );
    }
    for (let i = 0; i < 5; i++) {
      await f.commitFile(f.work, 'a', String(i), `local work ${i}`);
      const result = await syncRemotes(ctx());
      expect(result.remotes.map((r) => r.error?.message ?? null)).toEqual([
        null,
        null,
      ]);
      expect(result.ok).toBe(true);
      for (const bare of [f.origin, backup]) {
        expect(await f.git(bare, 'log', '-1', '--format=%s', 'main')).toBe(
          `local work ${i}`,
        );
      }
    }
  });

  test('an unreachable remote is a per-remote error; others still sync', async () => {
    f = await remotesFixture();
    await f.git(f.work, 'remote', 'add', 'bogus', join(f.base, 'missing.git'));
    await f.commitFile(f.work, 'a', '1', 'local work');
    const result = await syncRemotes(ctx());
    expect(result.ok).toBe(false);
    const by = (name: string) => result.remotes.find((r) => r.remote === name);
    expect(by('origin')).toMatchObject({ pushed: 'pushed' });
    expect(by('bogus')?.error?.kind).toBe('unreachable');
    expect(by('bogus')?.error?.message).toContain('bogus');
  });

  test('an auth failure is reported, never prompted for', async () => {
    f = await remotesFixture();
    // A local HTTP "remote" that wants credentials.
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () =>
        new Response('no', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Basic realm="x"' },
        }),
    });
    try {
      // No credential helper from the user's config may answer.
      await f.git(f.work, 'config', '--local', 'credential.helper', '');
      await f.git(
        f.work,
        'remote',
        'add',
        'locked',
        `http://127.0.0.1:${server.port}/repo.git`,
      );
      const result = await fetchRemotes(ctx(), { remote: 'locked' });
      expect(result.ok).toBe(false);
      expect(result.remotes[0]?.error?.kind).toBe('auth');
      expect(result.remotes[0]?.error?.message).toContain('locked');
    } finally {
      await server.stop(true);
    }
  });

  test('refuses while a merge is in progress', async () => {
    f = await remotesFixture();
    await f.commitFile(f.work, 'README.md', 'ours\n');
    await peerCommit('README.md', 'theirs\n');
    await f.git(f.work, 'fetch', '-q');
    await f.git(f.work, 'merge', 'origin/main').catch(() => {});
    const status = await syncStatus(f.work);
    expect(status.operation).toBe('merge');
    expect(status.summary.state).toBe('operation');
    const err = await syncRemotes(ctx()).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: 'invalid_state',
      details: { reason: 'operation', operation: 'merge' },
    });
  });

  test('refuses on a detached HEAD', async () => {
    f = await remotesFixture();
    await f.git(f.work, 'checkout', '-q', '--detach');
    const err = await syncRemotes(ctx()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'invalid_state' });
  });
});

describe('single-remote operations', () => {
  test('push to a remote without the branch creates it', async () => {
    f = await remotesFixture();
    const backup = await f.addRemote('backup');
    const result = await pushRemotes(ctx(), { remote: 'backup' });
    expect(result.remotes).toEqual([{ remote: 'backup', pushed: 'created' }]);
    expect(await f.git(backup, 'branch', '--list')).toContain('main');
  });

  test('a rejected push suggests syncing again', async () => {
    f = await remotesFixture();
    await peerCommit('b', '2');
    await f.commitFile(f.work, 'a', '1');
    const result = await pushRemotes(ctx(), { remote: 'origin' });
    expect(result.ok).toBe(false);
    expect(result.remotes[0]?.error?.kind).toBe('rejected');
    expect(result.remotes[0]?.error?.message).toContain('Sync again');
  });

  test('pull merges but does not push', async () => {
    f = await remotesFixture();
    await f.commitFile(f.work, 'a', '1', 'local');
    await peerCommit('b', '2', 'peer');
    const before = await originLog();
    const result = await pullRemotes(ctx(), { remote: 'origin' });
    expect(result.remotes[0]).toMatchObject({ integrated: 'merge' });
    expect(result.remotes[0]?.pushed).toBeUndefined();
    expect(await originLog()).toEqual(before);
  });

  test('pull from a remote without the branch is an error', async () => {
    f = await remotesFixture();
    await f.addRemote('backup');
    const result = await pullRemotes(ctx(), { remote: 'backup' });
    expect(result.remotes[0]?.error?.kind).toBe('no-branch');
  });

  test('an excluded remote can still be synced on its own', async () => {
    f = await remotesFixture();
    await setSyncIncluded(ctx(), 'origin', false);
    await f.commitFile(f.work, 'a', '1', 'local');
    expect((await syncRemotes(ctx())).remotes).toEqual([]);
    const result = await syncRemotes(ctx(), { remote: 'origin' });
    expect(result.remotes[0]?.pushed).toBe('pushed');
  });

  test('an unknown remote is not_found', async () => {
    f = await remotesFixture();
    for (const run of [
      () => fetchRemotes(ctx(), { remote: 'nope' }),
      () => syncRemotes(ctx(), { remote: 'nope' }),
      () => setSyncIncluded(ctx(), 'nope', false),
    ]) {
      expect(await run().catch((e: unknown) => e)).toMatchObject({
        code: 'not_found',
      });
    }
  });
});
