import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { serializeIssue } from '../core/issue.ts';
import type { Issue } from '../core/types.ts';
import {
  initIssuesDir,
  readConfig,
  writeConfig,
  writeIssue,
} from '../fs/issue-store.ts';
import { allocateIssueId, maxIssueIdInRefs, nextIdPath } from './ids.ts';

const ENTRY = join(import.meta.dir, '..', '..', 'index.ts');

let tmp: string;
let repo: string;

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 1,
    title: 'Test Issue',
    status: 'backlog',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2025-01-01T00:00:00Z',
    createdBy: 'tester',
    updated: '2025-01-01T00:00:00Z',
    description: '',
    comments: [],
    ...overrides,
  };
}

async function initRepo(path: string, initArgs: string[] = []): Promise<void> {
  await mkdir(path, { recursive: true });
  const git = simpleGit(path);
  await git.raw(['init', '-b', 'main', ...initArgs]);
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await initIssuesDir(path);
  await git.add('.');
  await git.commit('init');
}

/** Commit an issue file on `branch` (created from HEAD), then switch back. */
async function commitOnBranch(
  path: string,
  branch: string,
  issue: Issue,
  opts: { closed?: boolean } = {},
): Promise<void> {
  const git = simpleGit(path);
  const current = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
  await git.checkoutLocalBranch(branch);
  await mkdir(join(path, '.issues', 'closed'), { recursive: true });
  await writeIssue(path, issue, opts);
  await git.add('.');
  await git.commit(`issue #${issue.id}`);
  await git.checkout(current);
}

async function configText(path: string): Promise<string> {
  return readFile(join(path, '.issues', 'config.yaml'), 'utf-8');
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gitrac-ids-'));
  repo = join(tmp, 'repo');
  await initRepo(repo);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('allocateIssueId', () => {
  test('allocates sequentially and records the high-water mark in the common dir', async () => {
    const before = await configText(repo);
    expect(await allocateIssueId(repo)).toBe(1);
    expect(await allocateIssueId(repo)).toBe(2);
    expect(await allocateIssueId(repo)).toBe(3);
    expect(
      await readFile(join(repo, '.git', 'gitrac', 'next-id'), 'utf-8'),
    ).toBe('4\n');
    // config.yaml is never written
    expect(await configText(repo)).toBe(before);
  });

  test('never reuses an ID whose file was deleted (high-water mark)', async () => {
    const id = await allocateIssueId(repo);
    await writeIssue(repo, makeIssue({ id }));
    await unlink(join(repo, '.issues', `${id}-test-issue.md`));
    expect(await allocateIssueId(repo)).toBe(id + 1);
  });

  test('skips IDs used by issue files in the working tree', async () => {
    await writeIssue(repo, makeIssue({ id: 5, title: 'Five' }));
    await writeIssue(repo, makeIssue({ id: 8, title: 'Eight' }), {
      closed: true,
    });
    expect(await allocateIssueId(repo)).toBe(9);
  });

  test('respects a higher ID on a branch that is not checked out', async () => {
    await commitOnBranch(repo, 'feature', makeIssue({ id: 7, title: 'Seven' }));
    await commitOnBranch(
      repo,
      'other',
      makeIssue({ id: 11, title: 'Eleven', status: 'done' }),
      { closed: true },
    );
    expect(await maxIssueIdInRefs(repo)).toBe(11);
    expect(await allocateIssueId(repo)).toBe(12);
  });

  test('respects remote-tracking branches', async () => {
    const upstream = join(tmp, 'upstream');
    await initRepo(upstream);
    await commitOnBranch(upstream, 'theirs', makeIssue({ id: 30 }));
    const clone = join(tmp, 'clone');
    await simpleGit(tmp).clone(upstream, clone);
    // The clone only has `main` checked out; #30 lives on origin/theirs.
    expect(await maxIssueIdInRefs(clone)).toBe(30);
    expect(await allocateIssueId(clone)).toBe(31);
  });

  test('a legacy nextId in config.yaml is a lower bound and is not bumped', async () => {
    const config = await readConfig(repo);
    config.nextId = 20;
    await writeConfig(repo, config);
    const before = await configText(repo);
    expect(await allocateIssueId(repo)).toBe(20);
    expect(await allocateIssueId(repo)).toBe(21);
    expect(await configText(repo)).toBe(before);
  });

  test('ignores a corrupt high-water file', async () => {
    const path = (await nextIdPath(repo)) as string;
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, 'garbage');
    expect(await allocateIssueId(repo)).toBe(1);
    expect(await readFile(path, 'utf-8')).toBe('2\n');
  });

  test('works in SHA-256 repositories', async () => {
    const sha = join(tmp, 'sha256');
    try {
      await initRepo(sha, ['--object-format=sha256']);
    } catch {
      return; // git built without SHA-256 support
    }
    await commitOnBranch(sha, 'feature', makeIssue({ id: 4, title: 'Four' }));
    expect(await allocateIssueId(sha)).toBe(5);
  });

  test('works outside a git repo (files + legacy counter only)', async () => {
    const plain = join(tmp, 'plain');
    await mkdir(plain);
    await initIssuesDir(plain);
    expect(await nextIdPath(plain)).toBeNull();
    expect(await maxIssueIdInRefs(plain)).toBe(0);
    await writeFile(
      join(plain, '.issues', '3-x.md'),
      serializeIssue(makeIssue({ id: 3, title: 'x' })),
    );
    expect(await allocateIssueId(plain)).toBe(4);
  });
});

describe('worktrees', () => {
  async function cli(cwd: string, ...args: string[]) {
    const proc = Bun.spawn(
      [process.execPath, ENTRY, '--author', 'Tester', '-o', 'json', ...args],
      { cwd, stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    return JSON.parse(stdout) as Issue;
  }

  test('two worktrees creating issues get distinct IDs and leave config.yaml alone', async () => {
    const a = join(tmp, 'wt-a');
    const b = join(tmp, 'wt-b');
    const git = simpleGit(repo);
    await git.raw(['worktree', 'add', '-b', 'a', a]);
    await git.raw(['worktree', 'add', '-b', 'b', b]);
    const config = await configText(repo);

    const ids: number[] = [];
    // Interleave, and also create in parallel.
    ids.push((await cli(a, 'create', '-t', 'A1')).id);
    ids.push((await cli(b, 'create', '-t', 'B1')).id);
    ids.push(
      ...(
        await Promise.all([
          cli(a, 'create', '-t', 'A2'),
          cli(b, 'create', '-t', 'B2'),
          cli(repo, 'create', '-t', 'Main'),
        ])
      ).map((i) => i.id),
    );
    expect([...ids].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);

    // No create touched config.yaml, so the branches merge cleanly.
    for (const wt of [repo, a, b]) {
      expect(await configText(wt)).toBe(config);
      expect((await simpleGit(wt).status()).files).toEqual([]);
    }
    await git.merge(['a', 'b', '--no-edit']);
    expect((await simpleGit(repo).status()).conflicted).toEqual([]);
  }, 60_000);
});
