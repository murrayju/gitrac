import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { restorePaths, snapshotPaths } from './path-snapshot.ts';

let dir: string;

async function git(...args: string[]): Promise<string> {
  return simpleGit(dir).raw(args);
}

/** `git status --porcelain` plus the index entries, to compare repo states. */
async function repoState(): Promise<{ status: string; index: string }> {
  return {
    status: await git('status', '--porcelain', '--untracked-files=all'),
    index: await git('ls-files', '-s'),
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-snapshot-'));
  await git('init', '-q');
  await git('config', 'user.email', 'test@test.com');
  await git('config', 'user.name', 'Test');
  await git('config', 'commit.gpgsign', 'false');
  await Bun.write(join(dir, 'a.md'), 'a1\n');
  await Bun.write(join(dir, 'b.md'), 'b1\n');
  await git('add', '.');
  await git('commit', '-q', '-m', 'initial');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('snapshotPaths / restorePaths', () => {
  test('restores a moved file with staged and unstaged changes', async () => {
    // a.md: a staged change plus a different unstaged change.
    await Bun.write(join(dir, 'a.md'), 'a2\n');
    await git('add', 'a.md');
    await Bun.write(join(dir, 'a.md'), 'a3\n');
    const before = await repoState();
    const snapshot = await snapshotPaths(dir, ['a.md', 'closed/a.md']);

    // Move it away and stage the move, as a close does.
    await mkdir(join(dir, 'closed'));
    await rename(join(dir, 'a.md'), join(dir, 'closed', 'a.md'));
    await Bun.write(join(dir, 'closed', 'a.md'), 'closed\n');
    await git('add', '-A', '--', 'a.md', 'closed/a.md');

    await restorePaths(dir, snapshot);
    expect(await repoState()).toEqual(before);
    expect(await readFile(join(dir, 'a.md'), 'utf-8')).toBe('a3\n');
    expect(await git('show', ':a.md')).toBe('a2\n');
    expect(await Bun.file(join(dir, 'closed', 'a.md')).exists()).toBe(false);
  });

  test('restores an untracked file and a path that was not there', async () => {
    await Bun.write(join(dir, 'new.md'), 'new\n');
    const before = await repoState();
    const snapshot = await snapshotPaths(dir, ['new.md', 'gone.md']);

    await Bun.write(join(dir, 'new.md'), 'changed\n');
    await Bun.write(join(dir, 'gone.md'), 'x\n');
    await git('add', 'new.md', 'gone.md');

    await restorePaths(dir, snapshot);
    expect(await repoState()).toEqual(before);
    expect(await readFile(join(dir, 'new.md'), 'utf-8')).toBe('new\n');
    expect(await Bun.file(join(dir, 'gone.md')).exists()).toBe(false);
  });

  test('restores a staged deletion and keeps the file mode', async () => {
    await git('rm', '-q', '--cached', 'b.md');
    await Bun.write(join(dir, 'c.sh'), '#!/bin/sh\n');
    await Bun.$`chmod 755 ${join(dir, 'c.sh')}`;
    const before = await repoState();
    const snapshot = await snapshotPaths(dir, ['b.md', 'c.sh']);

    await git('add', 'b.md', 'c.sh');
    await rm(join(dir, 'c.sh'));

    await restorePaths(dir, snapshot);
    expect(await repoState()).toEqual(before);
    expect((await stat(join(dir, 'c.sh'))).mode & 0o777).toBe(0o755);
  });

  test('handles paths with spaces and an empty snapshot', async () => {
    await Bun.write(join(dir, 'with space.md'), 'x\n');
    await git('add', '.');
    const before = await repoState();
    const snapshot = await snapshotPaths(dir, ['with space.md']);
    expect(snapshot.get('with space.md')?.index).toHaveLength(1);
    await rm(join(dir, 'with space.md'));
    await git('add', '-A');
    await restorePaths(dir, snapshot);
    expect(await repoState()).toEqual(before);

    await restorePaths(dir, await snapshotPaths(dir, []));
    expect(await repoState()).toEqual(before);
  });
});
