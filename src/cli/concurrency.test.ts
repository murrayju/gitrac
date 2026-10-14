import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import type { Issue } from '../core/types.ts';
import { listIssueFiles, readConfig, readIssue } from '../fs/issue-store.ts';
import { createProgram } from './index.ts';

/**
 * Regression tests for #38: concurrent gitrac mutations must not produce
 * duplicate IDs, lost updates, or git `index.lock` / `HEAD` lock failures.
 */

const ENTRY = join(import.meta.dir, '..', '..', 'index.ts');
const N = 8;

let dir: string;

async function initRepo(): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-concurrency-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await Bun.write(join(dir, 'README.md'), 'hello');
  await git.add('.');
  await git.commit('initial');
}

/** Run the real CLI in a separate process. */
async function cli(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(
    [process.execPath, ENTRY, '--dir', dir, '--author', 'Tester', ...args],
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

function expectAllSucceeded(results: { code: number; stderr: string }[]): void {
  expect(results.map((r) => r.stderr.trim())).toEqual(Array(N).fill(''));
  expect(results.map((r) => r.code)).toEqual(Array(N).fill(0));
}

beforeEach(async () => {
  await initRepo();
  const init = await cli('init');
  expect(init.code).toBe(0);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parallel CLI processes', () => {
  test(`${N} parallel creates produce ${N} distinct IDs and ${N} commits`, async () => {
    const before = await commitCount();
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        cli('-o', 'json', 'create', '-t', `Parallel ${i}`),
      ),
    );
    expectAllSucceeded(results);

    const ids = results.map((r) => (JSON.parse(r.stdout) as Issue).id);
    expect([...ids].sort((a, b) => a - b)).toEqual(
      Array.from({ length: N }, (_, i) => i + 1),
    );

    expect(await commitCount()).toBe(before + N);
    expect((await listIssueFiles(dir)).length).toBe(N);
    expect((await readConfig(dir)).nextId).toBe(N + 1);
    // Every commit captured its own issue + the counter: nothing left over
    const status = await simpleGit(dir).status();
    expect(status.files).toEqual([]);

    // Each create commit contains exactly one new issue file
    const log = await simpleGit(dir).log({ maxCount: N });
    for (const entry of log.all) {
      const files = (
        await simpleGit(dir).raw([
          'show',
          '--name-only',
          '--format=',
          entry.hash,
        ])
      )
        .trim()
        .split('\n')
        .filter((f) => f.startsWith('.issues/') && f.endsWith('.md'));
      expect(files.length).toBe(1);
    }
  }, 60_000);

  test(`${N} parallel --no-commit creates still get distinct IDs`, async () => {
    const before = await commitCount();
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        cli('-o', 'json', '--no-commit', 'create', '-t', `Uncommitted ${i}`),
      ),
    );
    expectAllSucceeded(results);
    const ids = new Set(results.map((r) => (JSON.parse(r.stdout) as Issue).id));
    expect(ids.size).toBe(N);
    expect(await commitCount()).toBe(before);
    expect((await listIssueFiles(dir)).length).toBe(N);
    expect((await readConfig(dir)).nextId).toBe(N + 1);
  }, 60_000);

  test(`${N} parallel comments on one issue are all kept`, async () => {
    expect((await cli('create', '-t', 'Target')).code).toBe(0);
    const before = await commitCount();
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        cli('-o', 'json', 'comment', '1', `comment ${i}`),
      ),
    );
    expectAllSucceeded(results);
    const issue = await readIssue(dir, 1);
    expect(issue.comments.map((c) => c.body).sort()).toEqual(
      Array.from({ length: N }, (_, i) => `comment ${i}`).sort(),
    );
    expect(await commitCount()).toBe(before + N);
    expect((await simpleGit(dir).status()).files).toEqual([]);
  }, 60_000);
});

describe('concurrent commands in one process', () => {
  test(`${N} concurrent creates produce ${N} distinct IDs and ${N} commits`, async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      const before = await commitCount();
      await Promise.all(
        Array.from({ length: N }, async (_, i) => {
          const program = createProgram();
          program.exitOverride();
          await program.parseAsync([
            'node',
            'gitrac',
            '--dir',
            dir,
            '--author',
            'Tester',
            'create',
            '-t',
            `In-process ${i}`,
          ]);
        }),
      );
      expect(await commitCount()).toBe(before + N);
      expect((await listIssueFiles(dir)).length).toBe(N);
      expect((await readConfig(dir)).nextId).toBe(N + 1);
      expect((await simpleGit(dir).status()).files).toEqual([]);
    } finally {
      logSpy.mockRestore();
    }
  }, 60_000);
});
