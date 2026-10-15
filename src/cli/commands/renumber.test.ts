import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  spyOn,
  test,
} from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { EXIT_CONFLICT, GitracError } from '../../core/errors.ts';
import { findIssueFiles, readIssue } from '../../fs/issue-store.ts';
import type { GlobalOptions } from '../global-options.ts';
import { type RenumberIO, resolveFileArg, runRenumber } from './renumber.ts';

/**
 * Regression tests for #69: `gitrac renumber`, on a real duplicate ID made
 * by two clones that each created #1 and then merged.
 */

// Each test spawns several CLI processes sequentially.
setDefaultTimeout(60_000);

const ENTRY = join(import.meta.dir, '..', '..', '..', 'index.ts');

let base: string;
/** Clone B, after merging clone A's #1 into its own #1. */
let dir: string;

async function cliIn(
  cwd: string,
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  // stdin is not a terminal here, like for an agent.
  const proc = Bun.spawn(
    [process.execPath, ENTRY, '--dir', cwd, '--author', 'Alice', ...args],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

const cli = (...args: string[]) => cliIn(dir, ...args);

async function ok(cwd: string, ...args: string[]): Promise<void> {
  const res = await cliIn(cwd, ...args);
  if (res.code !== 0) throw new Error(`${args.join(' ')}: ${res.stderr}`);
}

async function clone(origin: string, name: string): Promise<string> {
  const path = join(base, name);
  await simpleGit(base).clone(origin, path);
  const git = simpleGit(path);
  await git.addConfig('user.email', `${name}@test.com`);
  await git.addConfig('user.name', name);
  await git.addConfig('commit.gpgsign', 'false');
  return path;
}

async function subjects(): Promise<string[]> {
  return (await simpleGit(dir).log()).all.map((e) => e.message);
}

function jsonError(stderr: string): Record<string, unknown> {
  return JSON.parse(stderr.trim().split('\n').at(-1) ?? '').error;
}

const ALPHA = join('.issues', '1-alpha.md');
const BETA = join('.issues', '1-beta.md');

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'gitrac-renumber-'));
  const origin = join(base, 'origin.git');
  await simpleGit(base).init(true, [origin, '--initial-branch=main']);

  const a = await clone(origin, 'a');
  await Bun.write(join(a, 'README.md'), 'hello');
  await simpleGit(a).add('.').commit('initial');
  await ok(a, 'init');
  await simpleGit(a).push('origin', 'HEAD:main');

  dir = await clone(origin, 'b');
  // Neither clone has seen the other's issue: both allocate #1.
  await ok(a, 'create', '-t', 'Alpha');
  await ok(a, 'create', '-t', 'Blocked');
  await ok(a, 'link', '2', '--blocked-by', '1');
  await simpleGit(a).push('origin', 'HEAD:main');
  await ok(dir, 'create', '-t', 'Beta');
  await simpleGit(dir).pull('origin', 'main', { '--no-rebase': null });
  expect((await findIssueFiles(dir, 1)).map((f) => f.path)).toEqual([
    ALPHA,
    BETA,
  ]);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('a duplicate ID after merging two clones', () => {
  test('other commands report duplicate_issue pointing at gitrac renumber', async () => {
    const res = await cli('show', '1');
    expect(res.code).toBe(EXIT_CONFLICT);
    expect(res.stderr).toContain(
      'if they are different issues, renumber one of them.',
    );
    expect(res.stderr).toContain('gitrac renumber 1 --file <path>');

    const json = await cli('-o', 'json', 'show', '1');
    expect(jsonError(json.stderr)).toMatchObject({
      code: 'duplicate_issue',
      files: [ALPHA, BETA],
    });
  });

  test('renumber without --file (no terminal) lists the candidates and exits 3', async () => {
    const before = await subjects();
    const res = await cli('renumber', '1');
    expect(res.code).toBe(EXIT_CONFLICT);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain(`${ALPHA} ("Alpha")`);
    expect(res.stderr).toContain(`${BETA} ("Beta")`);
    expect(res.stderr).toContain('gitrac renumber 1 --file <path>');
    // Only one hint.
    expect(res.stderr.split('gitrac renumber').length).toBe(2);
    expect(await subjects()).toEqual(before);

    const json = await cli('-o', 'json', 'renumber', '1');
    expect(jsonError(json.stderr)).toMatchObject({
      code: 'duplicate_issue',
      id: 1,
      files: [ALPHA, BETA],
      candidates: [
        { path: ALPHA, title: 'Alpha' },
        { path: BETA, title: 'Beta' },
      ],
    });
  });

  test('renumber --file moves it to a fresh ID in one commit (-o json)', async () => {
    const res = await cli('renumber', '1', '--file', BETA, '-o', 'json');
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out).toMatchObject({
      renumbered: true,
      oldId: 1,
      newId: 3,
      from: BETA,
      to: join('.issues', '3-beta.md'),
      issue: { id: 3, title: 'Beta' },
      references: [
        {
          id: 2,
          title: 'Blocked',
          blockedBy: true,
          parent: false,
          mentions: false,
          updated: false,
          paths: [],
        },
      ],
    });
    expect((await subjects())[0]).toBe('issue: renumber #1 -> #3 Beta');
    expect((await simpleGit(dir).status()).isClean()).toBe(true);
    expect((await readIssue(dir, 1)).title).toBe('Alpha');
    expect((await readIssue(dir, 3)).title).toBe('Beta');
    // Not rewritten by default: the link was ambiguous.
    expect((await readIssue(dir, 2)).blockedBy).toEqual([1]);
    expect((await cli('show', '1')).code).toBe(0);
    // The next new issue gets the next ID.
    const created = await cli('create', '-t', 'Next', '-o', 'json');
    expect(JSON.parse(created.stdout).id).toBe(4);
  });

  test('human output lists the references that were not changed', async () => {
    const res = await cli('renumber', '1', '--file', '1-beta.md');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Renumbered #1 -> #3: Beta');
    expect(res.stdout).toContain(`${BETA} -> ${join('.issues', '3-beta.md')}`);
    expect(res.stdout).toContain('#2: Blocked (blockedBy)');
    expect(res.stdout).toContain('--update-refs');
  });

  test('--update-refs rewrites the links in the same commit', async () => {
    const res = await cli('renumber', '1', '-f', ALPHA, '--update-refs');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Links to #1 changed to #3 in:');
    expect((await readIssue(dir, 2)).blockedBy).toEqual([3]);
    const changed = await simpleGit(dir).raw([
      'show',
      '--no-renames',
      '--name-only',
      '--format=',
      'HEAD',
    ]);
    expect(changed.split('\n').filter(Boolean).sort()).toEqual([
      '.issues/1-alpha.md',
      '.issues/2-blocked.md',
      '.issues/3-alpha.md',
    ]);
    expect((await simpleGit(dir).status()).isClean()).toBe(true);
  });

  test('--no-commit renumbers without committing', async () => {
    const before = await subjects();
    const res = await cli('renumber', '1', '--file', BETA, '--no-commit');
    expect(res.code).toBe(0);
    expect(await subjects()).toEqual(before);
    expect(await findIssueFiles(dir, 3)).toHaveLength(1);
  });

  test('a non-duplicated ID needs --force', async () => {
    const res = await cli('renumber', '2');
    expect(res.code).toBe(EXIT_CONFLICT);
    expect(res.stderr).toContain('not duplicated');
    expect(res.stderr).toContain('--force');
    const forced = await cli('renumber', '2', '--force', '-o', 'json');
    expect(forced.code).toBe(0);
    expect(JSON.parse(forced.stdout)).toMatchObject({ oldId: 2, newId: 3 });
  });
});

describe('runRenumber on a terminal', () => {
  function opts(): GlobalOptions {
    return {
      dir,
      output: 'human',
      author: 'Alice',
      commit: true,
      push: false,
      port: 3000,
      host: '127.0.0.1',
    };
  }

  function tty(answer: string | null): RenumberIO & { asked: number } {
    const io = {
      asked: 0,
      isTTY: () => true,
      prompt: async () => {
        io.asked++;
        return answer;
      },
    };
    return io;
  }

  async function quietly<T>(fn: () => Promise<T>): Promise<T> {
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const error = spyOn(console, 'error').mockImplementation(() => {});
    try {
      return await fn();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  }

  test('asks which file and renumbers the chosen one', async () => {
    const io = tty('2');
    const result = await quietly(() => runRenumber(opts(), 1, {}, io));
    expect(io.asked).toBe(1);
    expect(result.from).toBe(BETA);
    expect((await readIssue(dir, 3)).title).toBe('Beta');
  });

  test('accepts a path as the answer', async () => {
    const result = await quietly(() => runRenumber(opts(), 1, {}, tty(ALPHA)));
    expect(result.from).toBe(ALPHA);
  });

  test('no answer aborts with confirmation_required', async () => {
    const err = await quietly(() =>
      runRenumber(opts(), 1, {}, tty('')).catch((e) => e),
    );
    expect(err).toBeInstanceOf(GitracError);
    expect((err as GitracError).code).toBe('confirmation_required');
    expect(await findIssueFiles(dir, 1)).toHaveLength(2);
  });

  test('does not ask with --file or when the ID is not duplicated', async () => {
    const io = tty('1');
    await quietly(() => runRenumber(opts(), 1, { file: BETA }, io));
    const err = await quietly(() =>
      runRenumber(opts(), 2, {}, io).catch((e) => e),
    );
    expect((err as GitracError).code).toBe('invalid_state');
    expect(io.asked).toBe(0);
  });
});

describe('resolveFileArg', () => {
  test('makes an existing cwd-relative or absolute path repo-relative', () => {
    expect(resolveFileArg(dir, join(dir, BETA))).toBe(BETA);
    expect(resolveFileArg(dir, '1-beta.md')).toBe('1-beta.md');
    expect(resolveFileArg(dir, BETA)).toBe(BETA);
  });
});
