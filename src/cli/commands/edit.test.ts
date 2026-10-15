import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { EXIT_INVALID_INPUT } from '../../core/errors.ts';
import { findIssueFile } from '../../fs/issue-store.ts';

/** Regression tests for #90: a no-op `edit` writes and commits nothing. */

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
  return readFile(join(dir, '.issues', found.filename), 'utf-8');
}

const DESCRIPTION = 'Intro\n\n```js\nconst a = 1;\n```';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-edit-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await Bun.write(join(dir, 'README.md'), 'hello');
  await git.add('.');
  await git.commit('initial');
  expect((await cli('init')).code).toBe(0);
  const created = await cli(
    'create',
    '-t',
    'Some work',
    '-p',
    'high',
    '-l',
    'bug',
    '-d',
    DESCRIPTION,
  );
  expect(created.code).toBe(0);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('edit', () => {
  test('values equal to the current ones write and commit nothing', async () => {
    const before = await issueText();
    const commits = await commitCount();
    const res = await cli(
      'edit',
      '1',
      '-t',
      'Some work',
      '-p',
      'high',
      '-l',
      'bug',
      '-d',
      `${DESCRIPTION}\n\n`,
      '-o',
      'json',
    );
    expect(res.code).toBe(0);
    expect(res.stderr).toBe(
      'Issue #1 already has these values; nothing changed.\n',
    );
    // stdout still carries the (unchanged) issue
    const shown = JSON.parse(res.stdout);
    expect(shown.id).toBe(1);
    expect(shown.description).toBe(DESCRIPTION);
    expect(await issueText()).toBe(before);
    expect(await commitCount()).toBe(commits);
    expect((await simpleGit(dir).status()).isClean()).toBe(true);
  });

  test('a real change is still written and committed', async () => {
    const commits = await commitCount();
    const res = await cli('edit', '1', '-p', 'low');
    expect(res.code).toBe(0);
    expect(res.stderr).toBe('');
    expect(await issueText()).toContain('priority: low');
    expect(await commitCount()).toBe(commits + 1);
  });

  test('a comment alone is a change', async () => {
    const commits = await commitCount();
    const res = await cli('edit', '1', '-t', 'Some work', '-c', 'note');
    expect(res.code).toBe(0);
    expect(res.stderr).toBe('');
    expect(await issueText()).toContain('note');
    expect(await commitCount()).toBe(commits + 1);
  });

  test('no field flags at all is a usage error', async () => {
    const before = await issueText();
    const res = await cli('edit', '1');
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stderr).toContain('Nothing to edit');
    expect(await issueText()).toBe(before);
  });
});
