import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { EXIT_CONFLICT, EXIT_INVALID_INPUT } from '../../core/errors.ts';
import {
  findIssueFile,
  listClosedIssueFiles,
  listIssueFiles,
  readConfig,
  readIssue,
  writeConfig,
} from '../../fs/issue-store.ts';

/** Regression tests for #50: close/reopen status + state consistency. */

// Each test spawns several CLI processes sequentially.
setDefaultTimeout(30_000);

const ENTRY = join(import.meta.dir, '..', '..', '..', 'index.ts');

let dir: string;

async function cli(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(
    [process.execPath, ENTRY, '--dir', dir, '--author', 'Alice', ...args],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

async function commitCount(): Promise<number> {
  return (await simpleGit(dir).log()).total;
}

async function issueText(): Promise<string> {
  const found = await findIssueFile(dir, 1);
  if (!found) throw new Error('issue #1 missing');
  const base = found.closed
    ? join(dir, '.issues', 'closed')
    : join(dir, '.issues');
  return readFile(join(base, found.filename), 'utf-8');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-close-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await Bun.write(join(dir, 'README.md'), 'hello');
  await git.add('.');
  await git.commit('initial');
  expect((await cli('init')).code).toBe(0);
  expect((await cli('create', '-t', 'Some work')).code).toBe(0);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('close', () => {
  test('closes an open issue into .issues/closed/', async () => {
    const res = await cli('close', '1');
    expect(res.code).toBe(0);
    expect(await listIssueFiles(dir)).toEqual([]);
    expect(await listClosedIssueFiles(dir)).toEqual(['1-some-work.md']);
    expect((await readIssue(dir, 1)).status).toBe('done');
    expect((await simpleGit(dir).status()).isClean()).toBe(true);
  });

  test('closing an already-closed issue fails with invalid_state and changes nothing', async () => {
    expect((await cli('close', '1', '--cancelled')).code).toBe(0);
    const before = await issueText();
    const commits = await commitCount();

    const res = await cli('-o', 'json', 'close', '1', '-c', 'again');
    expect(res.code).toBe(EXIT_CONFLICT);
    expect(res.stdout).toBe('');
    const err = JSON.parse(res.stderr.trim().split('\n').at(-1) ?? '');
    expect(err.error.code).toBe('invalid_state');
    expect(err.error.message).toContain('already closed');

    expect(await issueText()).toBe(before);
    expect(await listIssueFiles(dir)).toEqual([]);
    expect(await listClosedIssueFiles(dir)).toEqual(['1-some-work.md']);
    expect(await commitCount()).toBe(commits);
  });
});

describe('reopen', () => {
  test('uses config.defaultStatus instead of hard-coded backlog', async () => {
    const config = await readConfig(dir);
    config.defaultStatus = 'todo';
    await writeConfig(dir, config);
    expect((await cli('close', '1')).code).toBe(0);

    const res = await cli('reopen', '1');
    expect(res.code).toBe(0);
    expect((await readIssue(dir, 1)).status).toBe('todo');
    expect(await listIssueFiles(dir)).toEqual(['1-some-work.md']);
    expect(await listClosedIssueFiles(dir)).toEqual([]);
  });

  test('-s picks the reopen status', async () => {
    expect((await cli('close', '1')).code).toBe(0);
    expect((await cli('reopen', '1', '-s', 'in_progress')).code).toBe(0);
    expect((await readIssue(dir, 1)).status).toBe('in_progress');
  });

  test('-s rejects closed and unknown statuses without changing anything', async () => {
    expect((await cli('close', '1')).code).toBe(0);
    const commits = await commitCount();
    for (const status of ['done', 'bogus']) {
      const res = await cli('reopen', '1', '-s', status);
      expect(res.code).toBe(EXIT_INVALID_INPUT);
      expect(res.stderr).toContain('Invalid status');
    }
    expect((await readIssue(dir, 1)).status).toBe('done');
    expect(await listClosedIssueFiles(dir)).toEqual(['1-some-work.md']);
    expect(await commitCount()).toBe(commits);
  });

  test('reopening an open issue fails with invalid_state and changes nothing', async () => {
    const before = await issueText();
    const commits = await commitCount();

    const res = await cli('reopen', '1', '-c', 'nope');
    expect(res.code).toBe(EXIT_CONFLICT);
    expect(res.stderr).toContain('is not closed');

    expect(await issueText()).toBe(before);
    expect(await commitCount()).toBe(commits);
  });

  test('repairs a done issue left in the open dir', async () => {
    // Hand-edited status without moving the file
    const path = join(dir, '.issues', '1-some-work.md');
    const content = await readFile(path, 'utf-8');
    await writeFile(path, content.replace(/^status: .*$/m, 'status: done'));

    expect((await cli('reopen', '1')).code).toBe(0);
    expect((await readIssue(dir, 1)).status).toBe('backlog');
    expect(await listIssueFiles(dir)).toEqual(['1-some-work.md']);
    expect(await listClosedIssueFiles(dir)).toEqual([]);
  });
});
