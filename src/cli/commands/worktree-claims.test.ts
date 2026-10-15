import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { EXIT_ALREADY_CLAIMED } from '../../core/claim.ts';
import { readIssue } from '../../fs/issue-store.ts';

/**
 * Regression tests for #56: a claim made in one worktree (committed or not)
 * is visible to `claim` / `ready` / `next` / `ls` / `show` in the others.
 */

// Each test spawns several CLI processes sequentially.
setDefaultTimeout(60_000);

const ENTRY = join(import.meta.dir, '..', '..', '..', 'index.ts');

let tmp: string;
let main: string;
let wt1: string;
let wt2: string;

async function cli(
  dir: string,
  author: string,
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(
    [process.execPath, ENTRY, '--dir', dir, '--author', author, ...args],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

async function ok(dir: string, author: string, ...args: string[]) {
  const result = await cli(dir, author, ...args);
  expect({ args, code: result.code, stderr: result.stderr }).toMatchObject({
    code: 0,
  });
  return result.stdout;
}

async function json<T>(dir: string, author: string, ...args: string[]) {
  return JSON.parse(await ok(dir, author, '-o', 'json', ...args)) as T;
}

type Listed = { id: number; claimedElsewhere?: Record<string, string> };

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), 'gitrac-wt-claims-')));
  main = join(tmp, 'main');
  const git = simpleGit(tmp);
  await git.raw(['init', '-b', 'main', main]);
  const repo = simpleGit(main);
  await repo.addConfig('user.email', 'test@test.com');
  await repo.addConfig('user.name', 'Test');
  await repo.addConfig('commit.gpgsign', 'false');
  await Bun.write(join(main, 'README.md'), 'hello');
  await repo.add('.');
  await repo.commit('initial');
  await ok(main, 'Ada', 'init');
  await ok(main, 'Ada', 'create', '-t', 'First', '-s', 'todo', '-p', 'high');
  await ok(main, 'Ada', 'create', '-t', 'Second', '-s', 'todo');
  wt1 = join(tmp, 'wt-1');
  wt2 = join(tmp, 'wt-2');
  await repo.raw(['worktree', 'add', '-b', 'agent-1', wt1]);
  await repo.raw(['worktree', 'add', '-b', 'agent-2', wt2]);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('claims across worktrees', () => {
  test('an uncommitted claim in one worktree is seen by the others', async () => {
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    const where = `in worktree ${wt1} (branch agent-1)`;

    // claim refuses, saying where
    const res = await cli(wt2, 'Ada', 'claim', '1');
    expect(res.code).toBe(EXIT_ALREADY_CLAIMED);
    expect(res.stderr).toContain(
      `Error: Issue #1 is already claimed by Bob (in_progress) ${where}. Use --force to take it over.`,
    );
    expect((await readIssue(wt2, 1)).status).toBe('todo');
    const err = await cli(wt2, 'Ada', '-o', 'json', 'claim', '1');
    expect(JSON.parse(err.stderr).error).toMatchObject({
      code: 'already_claimed',
      assignee: 'Bob',
      claimedElsewhere: { ref: 'agent-1', worktree: wt1, assignee: 'Bob' },
    });

    // ready / next skip it
    const ready = await json<Listed[]>(wt2, 'Ada', 'ready');
    expect(ready.map((i) => i.id)).toEqual([2]);
    expect((await json<Listed>(wt2, 'Ada', 'next')).id).toBe(2);

    // ls / show say where it's claimed
    const listed = await json<Listed[]>(main, 'Ada', 'ls');
    expect(listed[0]?.claimedElsewhere).toMatchObject({
      ref: 'agent-1',
      worktree: wt1,
      assignee: 'Bob',
    });
    expect(listed[1]?.claimedElsewhere).toBeUndefined();
    expect(await ok(main, 'Ada', 'ls')).toContain(`[claimed ${where} by Bob]`);
    expect(await ok(wt2, 'Ada', 'show', '1')).toContain(
      `Elsewhere:  claimed ${where} by Bob (`,
    );
    expect(
      (await json<Listed>(wt2, 'Ada', 'show', '1')).claimedElsewhere,
    ).toMatchObject({ ref: 'agent-1', assignee: 'Bob' });
    // ... but not in the worktree that has the claim.
    expect(await ok(wt1, 'Bob', 'show', '1')).not.toContain('Elsewhere:');
  });

  test('--force takes it over; the newer claim is then seen everywhere', async () => {
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    await ok(wt2, 'Ada', 'claim', '1', '--force');
    expect(await readIssue(wt2, 1)).toMatchObject({
      status: 'in_progress',
      assignee: 'Ada',
    });
    const res = await cli(wt1, 'Bob', 'claim', '1');
    expect(res.code).toBe(EXIT_ALREADY_CLAIMED);
    expect(res.stderr).toContain(
      `claimed by Ada (in_progress) in worktree ${wt2} (branch agent-2)`,
    );
  });

  test('a newer unclaim wins over the claim', async () => {
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    expect((await cli(wt2, 'Ada', 'claim', '1')).code).toBe(
      EXIT_ALREADY_CLAIMED,
    );
    await ok(wt1, 'Bob', 'unclaim', '1', '--no-commit');
    expect(
      (await json<Listed[]>(wt2, 'Ada', 'ready')).map((i) => i.id),
    ).toEqual([1, 2]);
    await ok(wt2, 'Ada', 'claim', '1');
  });

  test('a committed claim on a branch outlives its worktree, until the branch is deleted', async () => {
    await ok(wt1, 'Bob', 'claim', '1');
    await simpleGit(main).raw(['worktree', 'remove', wt1]);
    const res = await cli(main, 'Ada', 'claim', '1');
    expect(res.code).toBe(EXIT_ALREADY_CLAIMED);
    expect(res.stderr).toContain(
      'already claimed by Bob (in_progress) on branch agent-1.',
    );
    expect(await ok(main, 'Ada', 'ls')).toContain(
      '[claimed on branch agent-1 by Bob]',
    );
    await simpleGit(main).raw(['branch', '-D', 'agent-1']);
    await ok(main, 'Ada', 'claim', '1');
  });

  test('agents sharing an identity get different issues from next --claim', async () => {
    const first = await json<Listed>(
      wt1,
      'Ada',
      'next',
      '--claim',
      '--no-commit',
    );
    const second = await json<Listed>(
      wt2,
      'Ada',
      'next',
      '--claim',
      '--no-commit',
    );
    expect([first.id, second.id]).toEqual([1, 2]);
    // My own claim elsewhere is still listed by ready (it's mine).
    expect(
      (await json<Listed[]>(main, 'Ada', 'ready')).map((i) => i.id),
    ).toEqual([1, 2]);
    expect((await cli(main, 'Ada', 'next')).code).toBe(5);
  });
});
