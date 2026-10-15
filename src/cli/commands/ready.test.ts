import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import type { Issue } from '../../core/types.ts';
import { readIssue } from '../../fs/issue-store.ts';

/** Regression tests for #55: `link` / `unlink` / `ready` / `next`. */

// Each test spawns several CLI processes sequentially.
setDefaultTimeout(60_000);

const ENTRY = join(import.meta.dir, '..', '..', '..', 'index.ts');

let dir: string;

async function cli(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(
    [process.execPath, ENTRY, '--dir', dir, '--author', 'Ada', ...args],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

async function ok(...args: string[]): Promise<string> {
  const result = await cli(...args);
  expect({ args, code: result.code, stderr: result.stderr }).toMatchObject({
    code: 0,
  });
  return result.stdout;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-ready-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await Bun.write(join(dir, 'README.md'), 'hello');
  await git.add('.');
  await git.commit('initial');
  await ok('init');
  await ok('create', '-t', 'First', '-s', 'todo');
  await ok('create', '-t', 'Second', '-s', 'todo', '-p', 'high');
  await ok('create', '-t', 'Third', '-s', 'todo', '-p', 'urgent');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('link / unlink', () => {
  test('link writes blockedBy/parent and show lists both directions', async () => {
    await ok('link', '3', '--blocked-by', '1,2', '--parent', '1');
    expect(await readIssue(dir, 3)).toMatchObject({
      blockedBy: [1, 2],
      parent: 1,
    });
    const log = await simpleGit(dir).log();
    expect(log.latest?.message).toBe('issue: link #3 Third');

    const shown = await ok('show', '3');
    expect(shown).toContain('Parent:     #1 First (todo)');
    expect(shown).toContain('Blocked by: #1 First (todo), #2 Second (todo)');
    const first = await ok('show', '1');
    expect(first).toContain('Sub-issues: #3 Third (todo)');
    expect(first).toContain('Blocks:     #3 Third (todo)');

    await ok('unlink', '3', '-b', '1', '--parent');
    expect(await readIssue(dir, 3)).toMatchObject({ blockedBy: [2] });
    expect((await readIssue(dir, 3)).parent).toBeUndefined();
  });

  test('cycles, self links and missing targets exit 2', async () => {
    await ok('link', '2', '-b', '1');
    for (const args of [
      ['link', '1', '-b', '2'],
      ['link', '1', '-b', '1'],
      ['link', '1', '-b', '9'],
      ['link', '1'],
    ]) {
      const result = await cli('-o', 'json', ...args);
      expect({ args, code: result.code }).toEqual({ args, code: 2 });
      expect(result.stderr).toContain('"code":"invalid_input"');
    }
    expect((await readIssue(dir, 1)).blockedBy).toBeUndefined();
  });
});

describe('ready / next', () => {
  test('ready lists unblocked issues by priority, then ID; -o json', async () => {
    await ok('link', '3', '-b', '1');
    const ready = JSON.parse(await ok('ready', '-o', 'json')) as Issue[];
    expect(ready.map((i) => i.id)).toEqual([2, 1]);

    await ok('close', '1');
    const after = JSON.parse(await ok('ready', '-o', 'json')) as Issue[];
    expect(after.map((i) => i.id)).toEqual([3, 2]);
  });

  test('next --claim claims the top ready issue; exit 5 when none', async () => {
    const claimed = JSON.parse(
      await ok('next', '--claim', '-o', 'json'),
    ) as Issue;
    expect(claimed).toMatchObject({
      id: 3,
      status: 'in_progress',
      assignee: 'Ada',
    });
    // Already-claimed work is skipped by next (but still listed by ready).
    expect(JSON.parse(await ok('next', '-o', 'json')).id).toBe(2);
    await ok('next', '--claim');
    await ok('next', '--claim');
    const none = await cli('-o', 'json', 'next', '--claim');
    expect(none.code).toBe(5);
    expect(none.stderr).toContain('"code":"no_ready_issues"');
    const ready = JSON.parse(await ok('ready', '-o', 'json')) as Issue[];
    expect(ready.map((i) => i.id)).toEqual([3, 2, 1]);
  });

  test('concurrent next --claim never picks the same issue', async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() => cli('-o', 'json', 'next', '--claim')),
    );
    expect(results.map((r) => r.code)).toEqual([0, 0, 0]);
    const ids = results.map((r) => (JSON.parse(r.stdout) as Issue).id);
    expect(ids.sort()).toEqual([1, 2, 3]);
  });
});
