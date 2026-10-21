import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AmendTracker } from './amend-tracker.ts';
import { type RemotesFixture, remotesFixture } from './remotes.fixture.ts';
import {
  aheadBehind,
  commitList,
  currentBranch,
  fetchRemote,
  isPublished,
  lastFetchTimes,
  listRemotes,
  mergeCommit,
  mergeConflicts,
  networkEnv,
  operationInProgress,
  pushBranch,
  recordFetch,
  resolveCommit,
  runGit,
  setRemoteIncluded,
} from './remotes.ts';

let f: RemotesFixture;

beforeEach(async () => {
  f = await remotesFixture();
});

afterEach(async () => {
  await f.cleanup();
});

describe('listRemotes / setRemoteIncluded', () => {
  test('lists remotes with redacted URLs, included by default', async () => {
    await f.git(
      f.work,
      'remote',
      'add',
      'secret',
      'https://u:pw@example.com/r.git',
    );
    const remotes = await listRemotes(f.work);
    expect(remotes).toEqual([
      { name: 'origin', url: f.origin, included: true },
      { name: 'secret', url: 'https://***@example.com/r.git', included: true },
    ]);
  });

  test('exclusion is stored in the local git config', async () => {
    await setRemoteIncluded(f.work, 'origin', false);
    expect(
      await f.git(f.work, 'config', '--local', 'remote.origin.gitracsync'),
    ).toBe('false');
    expect((await listRemotes(f.work))[0]?.included).toBe(false);
    await setRemoteIncluded(f.work, 'origin', true);
    // Including twice is fine (the key is already gone).
    await setRemoteIncluded(f.work, 'origin', true);
    expect((await listRemotes(f.work))[0]?.included).toBe(true);
  });
});

describe('ahead / behind and commit lists', () => {
  test('counts and lists commits both ways, capped', async () => {
    for (let i = 0; i < 3; i++)
      await f.commitFile(f.work, `w${i}`, 'x', `work ${i}`);
    await f.commitFile(f.peer, 'p', 'x', 'peer change');
    await f.git(f.peer, 'push', '-q');
    expect(await fetchRemote(f.work, 'origin')).toBeNull();
    const counts = await aheadBehind(f.work, 'main', 'origin/main');
    expect(counts).toEqual({ ahead: 3, behind: 1 });
    const list = await commitList(f.work, 'main', 'origin/main', 3, 2);
    expect(list.commits.map((c) => c.subject)).toEqual(['work 2', 'work 1']);
    expect(list.more).toBe(1);
    expect(list.commits[0]?.author).toBe('Test');
  });
});

describe('mergeConflicts', () => {
  test('reports conflicting files without touching the work tree', async () => {
    await f.commitFile(f.work, 'README.md', 'ours\n');
    await f.commitFile(f.peer, 'README.md', 'theirs\n');
    await f.git(f.peer, 'push', '-q');
    await fetchRemote(f.work, 'origin');
    const ours = (await resolveCommit(f.work, 'HEAD')) ?? '';
    const theirs = (await resolveCommit(f.work, 'origin/main')) ?? '';
    expect(await mergeConflicts(f.work, ours, theirs)).toEqual(['README.md']);
    expect(await f.git(f.work, 'status', '--porcelain')).toBe('');
  });

  test('clean when the sides touch different files', async () => {
    await f.commitFile(f.work, 'a', '1');
    await f.commitFile(f.peer, 'b', '2');
    await f.git(f.peer, 'push', '-q');
    await fetchRemote(f.work, 'origin');
    const ours = (await resolveCommit(f.work, 'HEAD')) ?? '';
    const theirs = (await resolveCommit(f.work, 'origin/main')) ?? '';
    expect(await mergeConflicts(f.work, ours, theirs)).toEqual([]);
  });
});

describe('mergeCommit', () => {
  test('aborts a conflicting merge and lists the files', async () => {
    await f.commitFile(f.work, 'README.md', 'ours\n');
    await f.commitFile(f.peer, 'README.md', 'theirs\n');
    await f.git(f.peer, 'push', '-q');
    await fetchRemote(f.work, 'origin');
    const head = await resolveCommit(f.work, 'HEAD');
    const failure = await mergeCommit(f.work, 'origin/main', 'merge');
    expect(failure?.kind).toBe('conflict');
    expect(failure?.files).toEqual(['README.md']);
    expect(await operationInProgress(f.work)).toBeNull();
    expect(await resolveCommit(f.work, 'HEAD')).toBe(head);
    expect(await f.git(f.work, 'status', '--porcelain')).toBe('');
  });

  test('refuses to overwrite local changes', async () => {
    await f.commitFile(f.work, 'a', '1');
    await f.commitFile(f.peer, 'README.md', 'theirs\n');
    await f.git(f.peer, 'push', '-q');
    await fetchRemote(f.work, 'origin');
    await writeFile(join(f.work, 'README.md'), 'dirty\n');
    const failure = await mergeCommit(f.work, 'origin/main', 'merge');
    expect(failure?.kind).toBe('local-changes');
    expect(await operationInProgress(f.work)).toBeNull();
  });
});

describe('operationInProgress', () => {
  test('detects a merge started in a terminal', async () => {
    await f.commitFile(f.work, 'README.md', 'ours\n');
    await f.commitFile(f.peer, 'README.md', 'theirs\n');
    await f.git(f.peer, 'push', '-q');
    await f.git(f.work, 'fetch', '-q');
    expect(await operationInProgress(f.work)).toBeNull();
    await f.git(f.work, 'merge', 'origin/main').catch(() => {});
    expect(await operationInProgress(f.work)).toBe('merge');
  });
});

describe('pushBranch', () => {
  test('pushes, reports up to date, creates and is rejected', async () => {
    await f.commitFile(f.work, 'a', '1');
    expect(await pushBranch(f.work, 'origin', 'main')).toEqual({
      outcome: 'pushed',
    });
    expect(await pushBranch(f.work, 'origin', 'main')).toEqual({
      outcome: 'up-to-date',
    });
    await f.addRemote('backup');
    expect(await pushBranch(f.work, 'backup', 'main')).toEqual({
      outcome: 'created',
    });
    await f.git(f.peer, 'pull', '-q');
    await f.commitFile(f.peer, 'b', '2');
    await f.git(f.peer, 'push', '-q');
    await f.commitFile(f.work, 'c', '3');
    const rejected = await pushBranch(f.work, 'origin', 'main');
    expect('kind' in rejected && rejected.kind).toBe('rejected');
  });
});

describe('network failures', () => {
  test('a bad remote fails fast and never prompts', async () => {
    await f.git(f.work, 'remote', 'add', 'bogus', join(f.base, 'missing.git'));
    const failure = await fetchRemote(f.work, 'bogus');
    expect(failure?.kind).toBe('unreachable');
  });

  test('a command that runs too long is stopped', async () => {
    const run = await runGit(f.work, ['-c', 'alias.slow=!sleep 5', 'slow'], {
      timeoutMs: 100,
    });
    expect(run.timedOut).toBe(true);
  });

  test('ssh runs in batch mode unless the user set an ssh command', async () => {
    const saved = {
      cmd: process.env.GIT_SSH_COMMAND,
      ssh: process.env.GIT_SSH,
    };
    delete process.env.GIT_SSH_COMMAND;
    delete process.env.GIT_SSH;
    try {
      const env = await networkEnv(f.work);
      expect(env.GIT_TERMINAL_PROMPT).toBe('0');
      expect(env.GIT_SSH_COMMAND).toContain('BatchMode=yes');
      await f.git(f.work, 'config', 'core.sshCommand', 'ssh -i key');
      expect((await networkEnv(f.work)).GIT_SSH_COMMAND).toBeUndefined();
    } finally {
      if (saved.cmd !== undefined) process.env.GIT_SSH_COMMAND = saved.cmd;
      if (saved.ssh !== undefined) process.env.GIT_SSH = saved.ssh;
    }
  });
});

describe('fetch times', () => {
  test('recorded per remote', async () => {
    const when = new Date('2026-01-02T03:04:05.000Z');
    await recordFetch(f.work, ['origin'], when);
    const times = await lastFetchTimes(f.work, [
      { name: 'origin', rawUrl: f.origin },
      { name: 'other', rawUrl: '/x' },
    ]);
    expect(times.get('other')).toBeNull();
    // A terminal fetch of origin (FETCH_HEAD) is newer.
    await f.git(f.work, 'fetch', '-q', 'origin');
    const after = await lastFetchTimes(f.work, [
      { name: 'origin', rawUrl: f.origin },
    ]);
    expect((after.get('origin') ?? '') > when.toISOString()).toBe(true);
  });
});

describe('isPublished and amending', () => {
  test('a commit on any remote is published', async () => {
    await f.commitFile(f.work, 'a', '1');
    expect(await isPublished(f.work)).toBe(false);
    await f.addRemote('backup');
    await pushBranch(f.work, 'backup', 'main');
    expect(await isPublished(f.work)).toBe(true);
  });

  test('AmendTracker never amends a commit pushed to a non-upstream remote', async () => {
    const hash = await f.commitFile(f.work, 'a', '1');
    const tracker = new AmendTracker();
    tracker.record(1, hash);
    // Ahead of the upstream (origin), so amendable so far.
    expect(await tracker.canAmend(f.work, 1)).toBe(true);
    await f.addRemote('backup');
    await pushBranch(f.work, 'backup', 'main');
    expect(await tracker.canAmend(f.work, 1)).toBe(false);
  });
});

test('currentBranch is null when HEAD is detached', async () => {
  expect(await currentBranch(f.work)).toBe('main');
  await f.git(f.work, 'checkout', '-q', '--detach');
  expect(await currentBranch(f.work)).toBeNull();
});
