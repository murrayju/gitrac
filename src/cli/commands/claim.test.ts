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
import { EXIT_ALREADY_CLAIMED, EXIT_ISSUE_CLOSED } from '../../core/claim.ts';
import type { Issue } from '../../core/types.ts';
import { findIssueFile, readIssue } from '../../fs/issue-store.ts';

/** Regression tests for #42: `claim` must be exclusive; `unclaim` gives back. */

// Each test spawns several CLI processes sequentially.
setDefaultTimeout(30_000);

const ENTRY = join(import.meta.dir, '..', '..', '..', 'index.ts');

let dir: string;

/** Run the real CLI in a separate process (as `--author <author>` if given). */
async function cli(
  author: string | null,
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const authorArgs = author ? ['--author', author] : [];
  const proc = Bun.spawn(
    [process.execPath, ENTRY, '--dir', dir, ...authorArgs, ...args],
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

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-claim-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await Bun.write(join(dir, 'README.md'), 'hello');
  await git.add('.');
  await git.commit('initial');
  expect((await cli('Alice', 'init')).code).toBe(0);
  expect((await cli('Alice', 'create', '-t', 'Shared work')).code).toBe(0);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('claim', () => {
  test("refuses to steal another user's in_progress issue", async () => {
    expect((await cli('Alice', 'claim', '1')).code).toBe(0);
    const before = await commitCount();

    const res = await cli('Bob', 'claim', '1');
    expect(res.code).toBe(EXIT_ALREADY_CLAIMED);
    expect(res.stderr).toContain(
      'Error: Issue #1 is already claimed by Alice (in_progress). Use --force to take it over.',
    );

    const issue = await readIssue(dir, 1);
    expect(issue.assignee).toBe('Alice');
    expect(issue.status).toBe('in_progress');
    expect(await commitCount()).toBe(before);
  });

  test('--force takes over', async () => {
    expect((await cli('Alice', 'claim', '1')).code).toBe(0);
    const res = await cli('Bob', 'claim', '1', '--force');
    expect(res.code).toBe(0);
    expect((await readIssue(dir, 1)).assignee).toBe('Bob');
  });

  test('re-claiming your own issue is an idempotent no-op', async () => {
    expect((await cli('Alice', 'claim', '1')).code).toBe(0);
    const before = await commitCount();
    const fileBefore = await Bun.file(
      join(dir, '.issues', '1-shared-work.md'),
    ).text();

    const res = await cli('Alice', '-o', 'json', 'claim', '1');
    expect(res.code).toBe(0);
    expect((JSON.parse(res.stdout) as Issue).assignee).toBe('Alice');
    expect(res.stderr).toContain('already claimed by you');
    expect(await commitCount()).toBe(before);
    expect(
      await Bun.file(join(dir, '.issues', '1-shared-work.md')).text(),
    ).toBe(fileBefore);
  });

  test('git identity (email) owns the claim when --author is not given', async () => {
    expect((await cli(null, 'claim', '1')).code).toBe(0);
    expect((await readIssue(dir, 1)).assignee).toBe('test@test.com');
    const before = await commitCount();
    expect((await cli(null, 'claim', '1')).code).toBe(0);
    expect(await commitCount()).toBe(before);
    expect((await cli('Bob', 'claim', '1')).code).toBe(EXIT_ALREADY_CLAIMED);
  });

  test('claiming a closed issue requires --force', async () => {
    expect((await cli('Alice', 'close', '1')).code).toBe(0);
    const before = await commitCount();

    const res = await cli('Bob', 'claim', '1');
    expect(res.code).toBe(EXIT_ISSUE_CLOSED);
    // The CLI adds its own hint to the service's surface-neutral message
    expect(res.stderr).toContain(
      'Error: Issue #1 is closed (done). Use "gitrac reopen 1" first, or claim --force to reopen and claim it.',
    );
    expect((await findIssueFile(dir, 1))?.closed).toBe(true);
    expect((await readIssue(dir, 1)).status).toBe('done');
    expect(await commitCount()).toBe(before);

    const forced = await cli('Bob', 'claim', '1', '--force');
    expect(forced.code).toBe(0);
    expect((await findIssueFile(dir, 1))?.closed).toBe(false);
    const issue = await readIssue(dir, 1);
    expect(issue.status).toBe('in_progress');
    expect(issue.assignee).toBe('Bob');
    expect(await commitCount()).toBe(before + 1);
    expect((await simpleGit(dir).status()).isClean()).toBe(true);
  });

  test('concurrent claims: exactly one wins', async () => {
    const users = ['A', 'B', 'C', 'D', 'E', 'F'];
    const results = await Promise.all(users.map((u) => cli(u, 'claim', '1')));
    const winners = results.filter((r) => r.code === 0);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => r.code === EXIT_ALREADY_CLAIMED)).toHaveLength(
      users.length - 1,
    );
    const winner = users[results.findIndex((r) => r.code === 0)];
    expect((await readIssue(dir, 1)).assignee).toBe(winner as string);
  });
});

describe('unclaim', () => {
  test('releases your own issue back to todo', async () => {
    expect((await cli('Alice', 'claim', '1')).code).toBe(0);
    const before = await commitCount();
    const res = await cli('Alice', 'unclaim', '1', '-c', 'Giving this back');
    expect(res.code).toBe(0);
    const issue = await readIssue(dir, 1);
    expect(issue.assignee).toBe('');
    expect(issue.status).toBe('todo');
    expect(issue.comments.at(-1)?.body).toBe('Giving this back');
    expect(await commitCount()).toBe(before + 1);
    expect((await simpleGit(dir).log()).latest?.message).toContain(
      'unclaim #1',
    );

    // Now someone else can claim it
    expect((await cli('Bob', 'claim', '1')).code).toBe(0);
  });

  test('`release` is an alias', async () => {
    expect((await cli('Alice', 'claim', '1')).code).toBe(0);
    expect((await cli('Alice', 'release', '1')).code).toBe(0);
    expect((await readIssue(dir, 1)).assignee).toBe('');
  });

  test("refuses to release someone else's issue without --force", async () => {
    expect((await cli('Alice', 'claim', '1')).code).toBe(0);
    const res = await cli('Bob', 'unclaim', '1');
    expect(res.code).toBe(EXIT_ALREADY_CLAIMED);
    expect(res.stderr).toContain(
      'Error: Issue #1 is claimed by Alice, not you. Use --force to release it anyway.',
    );
    expect((await readIssue(dir, 1)).assignee).toBe('Alice');

    expect((await cli('Bob', 'unclaim', '1', '--force')).code).toBe(0);
    expect((await readIssue(dir, 1)).assignee).toBe('');
  });

  test('unclaiming an unassigned issue is a no-op', async () => {
    const before = await commitCount();
    const res = await cli('Alice', 'unclaim', '1');
    expect(res.code).toBe(0);
    expect(await commitCount()).toBe(before);
  });

  test('unclaiming a closed issue fails', async () => {
    expect((await cli('Alice', 'claim', '1')).code).toBe(0);
    expect((await cli('Alice', 'close', '1')).code).toBe(0);
    expect((await cli('Alice', 'unclaim', '1')).code).toBe(EXIT_ISSUE_CLOSED);
  });
});
