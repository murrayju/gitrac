import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import {
  EXIT_CONFLICT,
  EXIT_GIT,
  EXIT_INVALID_INPUT,
} from '../../core/errors.ts';
import {
  listClosedIssueFiles,
  listIssueFiles,
  readIssue,
} from '../../fs/issue-store.ts';

// Each test spawns several CLI processes sequentially.
setDefaultTimeout(30_000);

const ENTRY = join(import.meta.dir, '..', '..', '..', 'index.ts');
const OPEN_FILE = join('.issues', '1-some-work.md');
const CLOSED_FILE = join('.issues', 'closed', '1-some-work.md');

let dir: string;

async function run(
  args: string[],
  options: { author?: string; env?: Record<string, string> } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(
    [
      process.execPath,
      ENTRY,
      '--dir',
      dir,
      '--author',
      options.author ?? 'Alice',
      ...args,
    ],
    {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, GIT_EDITOR: 'false', ...options.env },
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function cli(...args: string[]) {
  return run(args);
}

function git(...args: string[]): Promise<string> {
  return simpleGit(dir).raw(args);
}

async function head(): Promise<string> {
  return (await git('rev-parse', 'HEAD')).trim();
}

/** Files changed by the HEAD commit, with their git status letter. */
async function headFiles(): Promise<string[]> {
  const out = await git(
    'show',
    '--name-status',
    '--no-renames',
    '--format=',
    'HEAD',
  );
  return out.trim().split('\n').sort();
}

/** Everything a failed `gitrac commit` must leave unchanged. */
async function repoState() {
  const openPath = join(dir, OPEN_FILE);
  return {
    head: await head(),
    status: await git('status', '--porcelain', '--untracked-files=all'),
    index: await git('ls-files', '-s'),
    issue: (await Bun.file(openPath).exists())
      ? await readFile(openPath, 'utf-8')
      : null,
    closed: await listClosedIssueFiles(dir),
  };
}

async function stageCode(): Promise<void> {
  await Bun.write(join(dir, 'code.ts'), 'export const fix = 1;\n');
  await git('add', 'code.ts');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-commit-'));
  await git('init', '-q');
  await git('config', 'user.email', 'test@test.com');
  await git('config', 'user.name', 'Test');
  await git('config', 'commit.gpgsign', 'false');
  await Bun.write(join(dir, 'README.md'), 'hello\n');
  await git('add', '.');
  await git('commit', '-q', '-m', 'initial');
  expect((await cli('init')).code).toBe(0);
  expect((await cli('create', '-t', 'Some work')).code).toBe(0);
  expect((await cli('claim', '1')).code).toBe(0);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('gitrac commit', () => {
  test('closes the issue and commits it with the staged changes', async () => {
    await stageCode();
    const before = await head();
    const res = await cli(
      'commit',
      '1',
      '-c',
      'Fixed it.',
      '--',
      '-m',
      'fix: work (#1)',
    );
    expect(res.stderr).toBe('');
    expect(res.code).toBe(0);
    const hash = await head();
    expect(hash).not.toBe(before);
    expect(res.stdout).toContain('fix: work (#1)');
    expect(res.stdout).toContain(`Closed #1 (done) in ${hash.slice(0, 7)}`);

    expect((await git('log', '-1', '--format=%s')).trim()).toBe(
      'fix: work (#1)',
    );
    expect(await headFiles()).toEqual([
      `A\t${CLOSED_FILE}`,
      'A\tcode.ts',
      `D\t${OPEN_FILE}`,
    ]);
    expect((await git('rev-parse', 'HEAD~1')).trim()).toBe(before);
    expect(await git('status', '--porcelain')).toBe('');
    const issue = await readIssue(dir, 1);
    expect(issue.status).toBe('done');
    expect(issue.comments.at(-1)?.body).toBe('Fixed it.');
  });

  test('-o json prints one { issue, commit } object; git output goes to stderr', async () => {
    await stageCode();
    const res = await cli('-o', 'json', 'commit', '1', '--', '-m', 'fix (#1)');
    expect(res.code).toBe(0);
    const data = JSON.parse(res.stdout);
    expect(data.commit).toBe(await head());
    expect(data.issue.id).toBe(1);
    expect(data.issue.status).toBe('done');
    expect(res.stderr).toContain('fix (#1)');
  });

  test('-- -a commits all tracked changes without git add', async () => {
    await Bun.write(join(dir, 'README.md'), 'changed\n');
    const res = await cli('commit', '1', '--', '-a', '-m', 'fix (#1)');
    expect(res.code).toBe(0);
    expect(await headFiles()).toEqual([
      `A\t${CLOSED_FILE}`,
      `D\t${OPEN_FILE}`,
      'M\tREADME.md',
    ]);
    expect(await git('status', '--porcelain')).toBe('');
  });

  test('without -m, git takes the message from the editor', async () => {
    await stageCode();
    const editor = join(dir, '..', `${dir.split('/').at(-1)}-editor.sh`);
    await writeFile(editor, '#!/bin/sh\necho "edited message (#1)" > "$1"\n');
    await chmod(editor, 0o755);
    try {
      const res = await run(['commit', '1'], { env: { GIT_EDITOR: editor } });
      expect(res.code).toBe(0);
      expect((await git('log', '-1', '--format=%s')).trim()).toBe(
        'edited message (#1)',
      );
      expect(await listClosedIssueFiles(dir)).toEqual(['1-some-work.md']);
    } finally {
      await rm(editor, { force: true });
    }
  });

  test('nothing staged besides the issue: exit 2, nothing changed', async () => {
    const before = await repoState();
    const res = await cli('commit', '1', '--', '-m', 'x');
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stderr).toContain('Nothing is staged besides the issue.');
    expect(res.stderr).toContain('git add');
    expect(await repoState()).toEqual(before);
  });

  test('git pathspecs: exit 2, nothing changed', async () => {
    await stageCode();
    const before = await repoState();
    for (const args of [
      ['--', '-m', 'x', 'code.ts'],
      ['--', '-m', 'x', '--', 'code.ts'],
    ]) {
      const res = await cli('-o', 'json', 'commit', '1', ...args);
      expect(res.code).toBe(EXIT_INVALID_INPUT);
      const err = JSON.parse(res.stderr.trim().split('\n').at(-1) ?? '');
      expect(err.error.code).toBe('invalid_input');
      expect(err.error.pathspecs).toEqual(['code.ts']);
      expect(err.error.message).toContain('git add');
    }
    expect(await repoState()).toEqual(before);
  });

  test('--no-commit is a usage error (exit 2)', async () => {
    await stageCode();
    const before = await repoState();
    const res = await cli('--no-commit', 'commit', '1', '--', '-m', 'x');
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stderr).toContain('--no-commit');
    expect(await repoState()).toEqual(before);
  });

  test('git commit fails: exit 7, issue file and index restored (incl. an uncommitted claim)', async () => {
    // An uncommitted claim by Bob (taken over from Alice): it must survive.
    expect(
      (await run(['--no-commit', 'claim', '1', '--force'], { author: 'Bob' }))
        .code,
    ).toBe(0);
    await stageCode();
    // A partly staged issue file, to check that the index is restored too.
    await git('add', OPEN_FILE);
    await writeFile(
      join(dir, OPEN_FILE),
      `${await readFile(join(dir, OPEN_FILE), 'utf-8')}\nlocal edit\n`,
    );
    const before = await repoState();

    const dry = await run(
      ['-o', 'json', 'commit', '1', '--', '--dry-run', '-m', 'x'],
      {
        author: 'Bob',
      },
    );
    expect(dry.code).toBe(EXIT_GIT);
    const err = JSON.parse(dry.stderr.trim().split('\n').at(-1) ?? '');
    expect(err.error.code).toBe('git_error');
    expect(dry.stdout).toBe('');
    expect(await repoState()).toEqual(before);

    await writeFile(
      join(dir, '.git', 'hooks', 'commit-msg'),
      '#!/bin/sh\necho "rejected by hook" >&2\nexit 1\n',
    );
    await chmod(join(dir, '.git', 'hooks', 'commit-msg'), 0o755);
    const hook = await run(
      ['-o', 'json', 'commit', '1', '-c', 'note', '--', '-m', 'x'],
      {
        author: 'Bob',
      },
    );
    expect(hook.code).toBe(EXIT_GIT);
    expect(hook.stderr).toContain('rejected by hook');
    const hookErr = JSON.parse(hook.stderr.trim().split('\n').at(-1) ?? '');
    expect(hookErr.error.exitCode).toBe(1);
    expect(await repoState()).toEqual(before);
    const issue = await readIssue(dir, 1);
    expect(issue.assignee).toBe('Bob');
    expect(issue.status).toBe('in_progress');
    expect(await listIssueFiles(dir)).toEqual(['1-some-work.md']);
  });

  test("closing someone else's claim needs -f (exit 3 without it)", async () => {
    await stageCode();
    const before = await repoState();
    const res = await run(['commit', '1', '--', '-m', 'x'], { author: 'Bob' });
    expect(res.code).toBe(EXIT_CONFLICT);
    expect(res.stderr).toContain('--force');
    expect(await repoState()).toEqual(before);

    const forced = await run(['commit', '1', '-f', '--', '-m', 'fix (#1)'], {
      author: 'Bob',
    });
    expect(forced.code).toBe(0);
    expect((await readIssue(dir, 1)).status).toBe('done');
    expect(await git('status', '--porcelain')).toBe('');
  });

  test('--push pushes the commit', async () => {
    const remote = await mkdtemp(join(tmpdir(), 'gitrac-commit-remote-'));
    try {
      await simpleGit(remote).raw(['init', '-q', '--bare']);
      await git('remote', 'add', 'origin', remote);
      const branch = (await git('branch', '--show-current')).trim();
      await git('push', '-q', '-u', 'origin', branch);
      await stageCode();
      const res = await cli('--push', 'commit', '1', '--', '-m', 'fix (#1)');
      expect(res.code).toBe(0);
      const pushed = await simpleGit(remote).raw(['rev-parse', branch]);
      expect(pushed.trim()).toBe(await head());
    } finally {
      await rm(remote, { recursive: true, force: true });
    }
  });
});
