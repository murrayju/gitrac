import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import {
  EXIT_ALREADY_CLAIMED,
  EXIT_CONFLICT,
  EXIT_GENERAL,
  EXIT_GIT,
  EXIT_INVALID_INPUT,
  EXIT_NOT_A_PROJECT,
  EXIT_NOT_FOUND,
} from '../core/errors.ts';

/**
 * Regression tests for #46: every CLI failure goes through one top-level
 * handler — `Error: <message>` in human mode, a single-line
 * `{"error":{"code","message"}}` on stderr with `-o json` — with distinct exit
 * codes, no stack traces unless `--debug`, and nothing but the result on
 * stdout (branch warnings go to stderr).
 */

// Each test spawns several CLI processes sequentially.
setDefaultTimeout(30_000);

const ENTRY = join(import.meta.dir, '..', '..', 'index.ts');

let root: string;

async function cli(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(
    [process.execPath, ENTRY, '--author', 'Tester', ...args],
    { cwd: root, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** Parse the JSON error (the last stderr line) and check its shape. */
function jsonError(stderr: string): {
  code: string;
  message: string;
  [key: string]: unknown;
} {
  const last = stderr.trimEnd().split('\n').at(-1) ?? '';
  const parsed = JSON.parse(last);
  expect(typeof parsed.error.code).toBe('string');
  expect(typeof parsed.error.message).toBe('string');
  return parsed.error;
}

function expectNoStack(stderr: string): void {
  expect(stderr).not.toMatch(/^\s+at /m);
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitrac-errors-')));
  const git = simpleGit(root);
  await git.init(['--initial-branch=main']);
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await Bun.write(join(root, 'README.md'), 'hello');
  await git.add('.');
  await git.commit('initial');
  expect((await cli('init')).code).toBe(0);
  expect((await cli('create', '-t', 'Existing')).code).toBe(0);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('human mode', () => {
  test('prints Error: <message> and exits with the error code', async () => {
    const res = await cli('show', '99');
    expect(res.code).toBe(EXIT_NOT_FOUND);
    expect(res.stderr.trim()).toBe('Error: Issue #99 not found');
    expect(res.stdout).toBe('');
  });

  test('stack traces only with --debug', async () => {
    const plain = await cli('show', '99');
    expectNoStack(plain.stderr);

    const debug = await cli('--debug', 'show', '99');
    expect(debug.code).toBe(EXIT_NOT_FOUND);
    expect(debug.stderr).toMatch(/^\s+at /m);
    expect(debug.stderr.trimEnd().split('\n').at(-1)).toBe(
      'Error: Issue #99 not found',
    );
  });

  test('a broken config.yaml is a friendly error, not a YAML stack', async () => {
    await Bun.write(join(root, '.issues', 'config.yaml'), 'version: [\n');
    const res = await cli('ls');
    expect(res.code).toBe(EXIT_GENERAL);
    expect(res.stderr).toMatch(/^Error: Invalid \.issues\/config\.yaml: /m);
    expect(res.stderr).not.toContain('YAMLException');
    expectNoStack(res.stderr);
  });
});

describe('-o json', () => {
  test.each([
    ['not found', ['show', '99'], 'not_found', EXIT_NOT_FOUND],
    [
      'not found (edit)',
      ['edit', '99', '-t', 'x'],
      'not_found',
      EXIT_NOT_FOUND,
    ],
    ['not found (close)', ['close', '99'], 'not_found', EXIT_NOT_FOUND],
    ['not found (reopen)', ['reopen', '99'], 'not_found', EXIT_NOT_FOUND],
    [
      'not found (comment)',
      ['comment', '99', 'hi'],
      'not_found',
      EXIT_NOT_FOUND,
    ],
    ['invalid ID', ['show', 'abc'], 'invalid_input', EXIT_INVALID_INPUT],
    [
      'invalid field',
      ['create', '-t', 'x', '-s', 'bogus'],
      'invalid_input',
      EXIT_INVALID_INPUT,
    ],
    ['missing argument', ['show'], 'usage', EXIT_INVALID_INPUT],
    ['unknown option', ['ls', '--bogus'], 'usage', EXIT_INVALID_INPUT],
    ['reopen an open issue', ['reopen', '1'], 'invalid_state', EXIT_CONFLICT],
    ['init twice', ['init'], 'already_initialized', EXIT_CONFLICT],
  ])('%s', async (_name, args, code, exit) => {
    const res = await cli('-o', 'json', ...args);
    expect(res.code).toBe(exit);
    expect(jsonError(res.stderr).code).toBe(code);
    expect(res.stdout).toBe('');
    expectNoStack(res.stderr);
  });

  test('validation errors carry every message', async () => {
    const res = await cli(
      '-o',
      'json',
      'create',
      '-t',
      'x',
      '-s',
      'a',
      '-p',
      'b',
    );
    const err = jsonError(res.stderr);
    expect(err.errors).toEqual([
      expect.stringContaining('Invalid status "a"'),
      expect.stringContaining('Invalid priority "b"'),
    ]);
  });

  test('already claimed includes the assignee', async () => {
    expect((await cli('--author', 'Alice', 'claim', '1')).code).toBe(0);
    const res = await cli('-o', 'json', '--author', 'Bob', 'claim', '1');
    expect(res.code).toBe(EXIT_ALREADY_CLAIMED);
    expect(jsonError(res.stderr)).toMatchObject({
      code: 'already_claimed',
      id: 1,
      assignee: 'Alice',
    });
  });

  test('git failures exit with EXIT_GIT and code git_error', async () => {
    const hook = join(root, '.git', 'hooks', 'pre-commit');
    await Bun.write(hook, '#!/bin/sh\necho "hook rejected" >&2\nexit 1\n');
    await chmod(hook, 0o755);
    const res = await cli('-o', 'json', 'comment', '1', 'hello');
    expect(res.code).toBe(EXIT_GIT);
    const err = jsonError(res.stderr);
    expect(err.code).toBe('git_error');
    expect(err.message).toContain('hook rejected');
    expectNoStack(res.stderr);
  });

  test('outside a gitrac project', async () => {
    await rm(join(root, '.issues'), { recursive: true });
    const res = await cli('-o', 'json', 'ls');
    expect(res.code).toBe(EXIT_NOT_A_PROJECT);
    expect(jsonError(res.stderr).code).toBe('not_initialized');
  });

  test('several files for one issue ID: duplicate_issue lists them', async () => {
    // `create -t Existing` wrote .issues/1-existing.md
    const copy = join(root, '.issues', 'closed', '1-copy.md');
    await Bun.write(
      copy,
      await Bun.file(join(root, '.issues', '1-existing.md')).text(),
    );
    for (const args of [
      ['show', '1'],
      ['comment', '1', 'hi'],
      ['claim', '1'],
    ]) {
      const res = await cli('-o', 'json', ...args);
      expect(res.code).toBe(EXIT_CONFLICT);
      expect(jsonError(res.stderr)).toMatchObject({
        code: 'duplicate_issue',
        id: 1,
        files: [
          join('.issues', '1-existing.md'),
          join('.issues', 'closed', '1-copy.md'),
        ],
      });
    }
    expect(
      await Bun.file(join(root, '.issues', '1-existing.md')).text(),
    ).not.toContain('hi');
  });

  test('a comment on a misnamed issue file commits the rename', async () => {
    const git = simpleGit(root);
    await git.mv(
      join('.issues', '1-existing.md'),
      join('.issues', '1-stale-name.md'),
    );
    await git.commit('hand rename');
    const res = await cli('comment', '1', 'hello');
    expect(res.code).toBe(0);
    expect((await git.status()).isClean()).toBe(true);
    const files = await git.raw(['ls-files', '.issues']);
    expect(files).toContain('.issues/1-existing.md');
    expect(files).not.toContain('1-stale-name.md');
  });

  test('-o yaml prints the error as YAML', async () => {
    const res = await cli('-o', 'yaml', 'show', '99');
    expect(res.code).toBe(EXIT_NOT_FOUND);
    expect(res.stderr).toContain('code: not_found');
  });

  test('an invalid -o value is a usage error', async () => {
    const res = await cli('-o', 'xml', 'ls');
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stderr).toMatch(/^Error: .*xml/);
    expect(res.stdout).toBe('');
  });

  test('branch warnings go to stderr, stdout stays parseable', async () => {
    await simpleGit(root).checkoutLocalBranch('feature');
    for (const args of [['ls'], ['show', '1']]) {
      const res = await cli('-o', 'json', ...args);
      expect(res.code).toBe(0);
      expect(res.stderr).toContain('Warning: You are on branch "feature"');
      expect(res.stdout).not.toContain('Warning');
      expect(() => JSON.parse(res.stdout)).not.toThrow();
    }
    // ...and on failure, the JSON error is still the last stderr line.
    const res = await cli('-o', 'json', 'show', '99');
    expect(res.stderr).toContain('Warning:');
    expect(jsonError(res.stderr).code).toBe('not_found');
  });
});
