import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { listIssueFiles, readIssue } from '../fs/issue-store.ts';
import { ProjectRootError, resolveProjectRoot } from './global-options.ts';

/**
 * Regression tests for #40: every command (and the web server) must resolve
 * the project root via `git rev-parse --show-toplevel`, so gitrac works from
 * any subdirectory of the repo, and fail with a friendly message otherwise.
 */

const ENTRY = join(import.meta.dir, '..', '..', 'index.ts');

let root: string;
let nested: string;
let outside: string;

async function initRepo(): Promise<void> {
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitrac-root-')));
  const git = simpleGit(root);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await Bun.write(join(root, 'README.md'), 'hello');
  await git.add('.');
  await git.commit('initial');
  nested = join(root, 'src', 'deep', 'er');
  await mkdir(nested, { recursive: true });
}

/** Run the real CLI in a separate process with the given cwd. */
async function cli(
  cwd: string,
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(
    [process.execPath, ENTRY, '--author', 'Tester', ...args],
    { cwd, stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function expectFriendlyError(stderr: string, pattern: RegExp): void {
  expect(stderr).toMatch(pattern);
  // No raw stack traces / ENOENT dumps.
  expect(stderr).not.toContain('ENOENT');
  expect(stderr).not.toMatch(/^\s+at /m);
}

beforeEach(async () => {
  await initRepo();
  outside = await realpath(await mkdtemp(join(tmpdir(), 'gitrac-nogit-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('resolveProjectRoot', () => {
  test('resolves the git root from a nested directory', async () => {
    await cli(root, 'init');
    expect(await resolveProjectRoot(nested)).toBe(root);
    expect(await resolveProjectRoot(root)).toBe(root);
  });

  test('requires an initialized tracker by default', async () => {
    const err = await resolveProjectRoot(nested).catch((e) => e);
    expect(err).toBeInstanceOf(ProjectRootError);
    expect(err.reason).toBe('not-initialized');
    expect(err.message).toContain('gitrac init');
  });

  test('requireInit: false skips the .issues check', async () => {
    expect(await resolveProjectRoot(nested, { requireInit: false })).toBe(root);
  });

  test('rejects directories outside a git repo', async () => {
    const err = await resolveProjectRoot(outside).catch((e) => e);
    expect(err).toBeInstanceOf(ProjectRootError);
    expect(err.reason).toBe('not-a-git-repo');
  });

  test('rejects a nonexistent directory', async () => {
    const err = await resolveProjectRoot(join(outside, 'nope')).catch((e) => e);
    expect(err).toBeInstanceOf(ProjectRootError);
  });
});

describe('CLI from a nested directory', () => {
  test('init from a subdirectory initializes at the git root', async () => {
    const res = await cli(nested, 'init');
    expect(res.code).toBe(0);
    expect(await Bun.file(join(root, '.issues/config.yaml')).exists()).toBe(
      true,
    );
    expect(await Bun.file(join(nested, '.issues/config.yaml')).exists()).toBe(
      false,
    );
  });

  describe('with an initialized tracker', () => {
    beforeEach(async () => {
      expect((await cli(root, 'init')).code).toBe(0);
    });

    test('create / ls / show / comment / claim / edit / close / reopen work from a subdirectory', async () => {
      const create = await cli(nested, 'create', '-t', 'From nested');
      expect(create.stderr).toBe('');
      expect(create.code).toBe(0);
      expect(await listIssueFiles(root)).toHaveLength(1);

      const ls = await cli(nested, 'ls');
      expect(ls.code).toBe(0);
      expect(ls.stdout).toContain('From nested');

      const show = await cli(nested, '-o', 'json', 'show', '1');
      expect(show.code).toBe(0);
      expect(JSON.parse(show.stdout).title).toBe('From nested');

      for (const args of [
        ['comment', '1', 'hi from nested'],
        ['claim', '1'],
        ['edit', '1', '-p', 'high'],
        ['close', '1'],
        ['reopen', '1'],
      ]) {
        const res = await cli(nested, ...args);
        expect({ args, stderr: res.stderr, code: res.code }).toEqual({
          args,
          stderr: '',
          code: 0,
        });
      }

      const issue = await readIssue(root, 1);
      expect(issue.priority).toBe('high');
      expect(issue.comments.map((c) => c.body)).toContain('hi from nested');
      // Nothing was written into the subdirectory.
      expect(await Bun.file(join(nested, '.issues/config.yaml')).exists()).toBe(
        false,
      );
      // Everything was committed at the root.
      expect((await simpleGit(root).status()).isClean()).toBe(true);
    });

    test('--dir pointing at a subdirectory resolves to the git root', async () => {
      const create = await cli(outside, '--dir', nested, 'create', '-t', 'X');
      expect(create.code).toBe(0);
      const ls = await cli(outside, '--dir', nested, 'ls');
      expect(ls.code).toBe(0);
      expect(ls.stdout).toContain('X');
    });

    test('serve starts from a subdirectory', async () => {
      const proc = Bun.spawn([process.execPath, ENTRY, 'serve', '-p', '0'], {
        cwd: nested,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      try {
        const reader = proc.stdout.getReader();
        let out = '';
        const deadline = Date.now() + 10_000;
        while (!out.includes('server running') && Date.now() < deadline) {
          const { value, done } = await reader.read();
          if (done) break;
          out += new TextDecoder().decode(value);
        }
        expect(out).toContain('server running');
      } finally {
        proc.kill();
        await proc.exited;
      }
    });
  });

  test('friendly error when .issues/ is not initialized', async () => {
    for (const args of [['ls'], ['show', '1'], ['create', '-t', 'x']]) {
      const res = await cli(nested, ...args);
      expect(res.code).toBe(1);
      expectFriendlyError(res.stderr, /not initialized.*Run "gitrac init"/);
    }
  });

  test('serve: friendly error when .issues/ is not initialized', async () => {
    const res = await cli(nested, 'serve', '-p', '0');
    expect(res.code).toBe(1);
    expectFriendlyError(res.stderr, /Run "gitrac init"/);
  });

  test('friendly error outside a git repo', async () => {
    for (const args of [['ls'], ['init'], ['serve', '-p', '0']]) {
      const res = await cli(outside, ...args);
      expect(res.code).toBe(1);
      expectFriendlyError(res.stderr, /Not inside a git repository/);
    }
  });
});
