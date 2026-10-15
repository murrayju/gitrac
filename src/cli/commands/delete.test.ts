import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  spyOn,
  test,
} from 'bun:test';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { EXIT_INVALID_INPUT, GitracError } from '../../core/errors.ts';
import { serializeIssue } from '../../core/issue.ts';
import { findIssueFile, readIssue } from '../../fs/issue-store.ts';
import type { GlobalOptions } from '../global-options.ts';
import { type DeleteIO, runDelete } from './delete.ts';

/** Regression tests for #59: `gitrac delete`. */

// Each test spawns several CLI processes sequentially.
setDefaultTimeout(30_000);

const ENTRY = join(import.meta.dir, '..', '..', '..', 'index.ts');

let dir: string;

async function cli(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  // stdin is not a terminal here, like for an agent.
  const proc = Bun.spawn(
    [process.execPath, ENTRY, '--dir', dir, '--author', 'Alice', ...args],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

async function subjects(): Promise<string[]> {
  return (await simpleGit(dir).log()).all.map((e) => e.message);
}

async function tracked(): Promise<string[]> {
  const out = await simpleGit(dir).raw(['ls-files', '.issues']);
  return out.split('\n').filter(Boolean);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-delete-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await Bun.write(join(dir, 'README.md'), 'hello');
  await git.add('.');
  await git.commit('initial');
  expect((await cli('init')).code).toBe(0);
  // Issue #1 has an image only it uses; #2 is unrelated.
  await mkdir(join(dir, '.issues', 'assets'), { recursive: true });
  await writeFile(join(dir, '.issues', 'assets', 'pic.png'), 'img');
  expect(
    (await cli('create', '-t', 'Dupe', '-d', '![pic](/.issues/assets/pic.png)'))
      .code,
  ).toBe(0);
  await git.add('.issues/assets/pic.png');
  await git.commit('add asset');
  expect((await cli('create', '-t', 'Keep')).code).toBe(0);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('gitrac delete', () => {
  test('refuses without --yes when stdin is not a terminal, printing the plan', async () => {
    const before = await subjects();
    const res = await cli('delete', '1');

    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stdout).toContain('Would delete #1: Dupe');
    expect(res.stdout).toContain(join('.issues', '1-dupe.md'));
    expect(res.stdout).toContain(join('.issues', 'assets', 'pic.png'));
    expect(res.stderr).toContain('--yes');
    expect(await findIssueFile(dir, 1)).not.toBeNull();
    expect(await subjects()).toEqual(before);
  });

  test('-o json refusal: plan on stdout, confirmation_required on stderr', async () => {
    const res = await cli('delete', '1', '-o', 'json');
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    const plan = JSON.parse(res.stdout);
    expect(plan).toMatchObject({
      deleted: false,
      issue: { id: 1, title: 'Dupe' },
      paths: [
        join('.issues', '1-dupe.md'),
        join('.issues', 'assets', 'pic.png'),
      ],
      assets: [join('.issues', 'assets', 'pic.png')],
    });
    const lastLine = res.stderr.trim().split('\n').at(-1) ?? '';
    expect(JSON.parse(lastLine).error.code).toBe('confirmation_required');
  });

  test('--dry-run prints the plan and exits 0 without deleting', async () => {
    const before = await subjects();
    const res = await cli('delete', '1', '--dry-run');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Would delete #1: Dupe');
    expect(await findIssueFile(dir, 1)).not.toBeNull();
    expect(await subjects()).toEqual(before);
  });

  test('--yes deletes the issue and its orphaned asset in one commit', async () => {
    const res = await cli('delete', '1', '--yes');

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Deleted #1: Dupe');
    expect((await subjects())[0]).toBe('issue: delete #1 Dupe');
    expect(await tracked()).not.toContain('.issues/1-dupe.md');
    expect(await tracked()).not.toContain('.issues/assets/pic.png');
    expect(await tracked()).toContain('.issues/2-keep.md');
    expect(await Bun.file(join(dir, '.issues/assets/pic.png')).exists()).toBe(
      false,
    );
    // The working tree is clean: nothing else to commit.
    expect((await simpleGit(dir).status()).isClean()).toBe(true);
  });

  test('-o json --yes prints the deletion', async () => {
    const res = await cli('rm', '#1', '-y', '-o', 'json');
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({
      deleted: true,
      issue: { id: 1 },
      assets: [join('.issues', 'assets', 'pic.png')],
    });
  });

  test('--no-commit deletes the files but does not commit', async () => {
    const before = await subjects();
    const res = await cli('delete', '1', '--yes', '--no-commit');
    expect(res.code).toBe(0);
    expect(await findIssueFile(dir, 1)).toBeNull();
    expect(await subjects()).toEqual(before);
    expect(await tracked()).toContain('.issues/1-dupe.md');
  });

  test('a missing issue exits 5', async () => {
    const res = await cli('delete', '9', '--yes');
    expect(res.code).toBe(5);
  });

  test('IDs of deleted issues are not reused', async () => {
    expect((await cli('delete', '2', '--yes')).code).toBe(0);
    const res = await cli('create', '-t', 'New', '-o', 'json');
    expect(JSON.parse(res.stdout).id).toBe(3);
  });
});

describe('runDelete confirmation on a terminal', () => {
  function opts(): GlobalOptions {
    return {
      dir,
      output: 'human',
      author: 'Alice',
      commit: false,
      push: false,
      port: 3000,
      host: '127.0.0.1',
    };
  }

  function tty(answer: string | null, onPrompt?: () => void): DeleteIO {
    return {
      isTTY: () => true,
      prompt: () => {
        onPrompt?.();
        return answer;
      },
    };
  }

  async function quietly<T>(fn: () => Promise<T>): Promise<T> {
    const log = spyOn(console, 'log').mockImplementation(() => {});
    try {
      return await fn();
    } finally {
      log.mockRestore();
    }
  }

  test('deletes after "y"', async () => {
    await quietly(() => runDelete(opts(), 1, {}, tty('y')));
    expect(await findIssueFile(dir, 1)).toBeNull();
  });

  test('anything else aborts with confirmation_required', async () => {
    for (const answer of ['n', '', null]) {
      const err = await quietly(() =>
        runDelete(opts(), 1, {}, tty(answer)).catch((e) => e),
      );
      expect(err).toBeInstanceOf(GitracError);
      expect((err as GitracError).code).toBe('confirmation_required');
    }
    expect(await findIssueFile(dir, 1)).not.toBeNull();
  });

  test('refuses if the issue changed while asking', async () => {
    const issue = await readIssue(dir, 1);
    const err = await quietly(() =>
      runDelete(
        opts(),
        1,
        {},
        tty('y', () => {
          // Someone edits the issue while the prompt is open.
          writeFileSync(
            join(dir, '.issues', '1-dupe.md'),
            serializeIssue({ ...issue, description: 'edited' }),
          );
        }),
      ).catch((e) => e),
    );
    expect((err as GitracError).code).toBe('invalid_state');
    expect((await readIssue(dir, 1)).description).toBe('edited');
  });
});
