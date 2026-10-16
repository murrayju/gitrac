import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { EXIT_ALREADY_CLAIMED, EXIT_ISSUE_CLOSED } from '../../core/claim.ts';
import {
  readConfig,
  readIssue,
  writeConfig,
  writeIssue,
} from '../../fs/issue-store.ts';

/**
 * Regression tests for #56: a claim made in one worktree (committed or not)
 * is visible to `claim` / `ready` / `next` / `ls` / `show` in the others.
 */

// Each test spawns several CLI processes sequentially.
setDefaultTimeout(60_000);

const ENTRY = join(import.meta.dir, '..', '..', '..', 'index.ts');

let tmp: string;
let main: string;
let wt1: string;
let wt2: string;

async function cli(
  dir: string,
  author: string,
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(
    [process.execPath, ENTRY, '--dir', dir, '--author', author, ...args],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

async function ok(dir: string, author: string, ...args: string[]) {
  const result = await cli(dir, author, ...args);
  expect({ args, code: result.code, stderr: result.stderr }).toMatchObject({
    code: 0,
  });
  return result.stdout;
}

async function json<T>(dir: string, author: string, ...args: string[]) {
  return JSON.parse(await ok(dir, author, '-o', 'json', ...args)) as T;
}

type Listed = {
  id: number;
  assignee?: string;
  claimedElsewhere?: Record<string, string>;
  closedElsewhere?: Record<string, string>;
  staleClaim?: Record<string, string>;
};

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), 'gitrac-wt-claims-')));
  main = join(tmp, 'main');
  const git = simpleGit(tmp);
  await git.raw(['init', '-b', 'main', main]);
  const repo = simpleGit(main);
  await repo.addConfig('user.email', 'test@test.com');
  await repo.addConfig('user.name', 'Test');
  await repo.addConfig('commit.gpgsign', 'false');
  await Bun.write(join(main, 'README.md'), 'hello');
  await repo.add('.');
  await repo.commit('initial');
  await ok(main, 'Ada', 'init');
  await ok(main, 'Ada', 'create', '-t', 'First', '-s', 'todo', '-p', 'high');
  await ok(main, 'Ada', 'create', '-t', 'Second', '-s', 'todo');
  wt1 = join(tmp, 'wt-1');
  wt2 = join(tmp, 'wt-2');
  await repo.raw(['worktree', 'add', '-b', 'agent-1', wt1]);
  await repo.raw(['worktree', 'add', '-b', 'agent-2', wt2]);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('claims across worktrees', () => {
  test('an uncommitted claim in one worktree is seen by the others', async () => {
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    const where = `in worktree ${wt1} (branch agent-1)`;

    // claim refuses, saying where
    const res = await cli(wt2, 'Ada', 'claim', '1');
    expect(res.code).toBe(EXIT_ALREADY_CLAIMED);
    expect(res.stderr).toContain(
      `Error: Issue #1 is already claimed by Bob (in_progress) ${where}. Use --force to take it over.`,
    );
    expect((await readIssue(wt2, 1)).status).toBe('todo');
    const err = await cli(wt2, 'Ada', '-o', 'json', 'claim', '1');
    expect(JSON.parse(err.stderr).error).toMatchObject({
      code: 'already_claimed',
      assignee: 'Bob',
      claimedElsewhere: { ref: 'agent-1', worktree: wt1, assignee: 'Bob' },
    });

    // ready / next skip it
    const ready = await json<Listed[]>(wt2, 'Ada', 'ready');
    expect(ready.map((i) => i.id)).toEqual([2]);
    expect((await json<Listed>(wt2, 'Ada', 'next')).id).toBe(2);

    // ls / show say where it's claimed
    const listed = await json<Listed[]>(main, 'Ada', 'ls');
    expect(listed[0]?.claimedElsewhere).toMatchObject({
      ref: 'agent-1',
      worktree: wt1,
      assignee: 'Bob',
    });
    expect(listed[1]?.claimedElsewhere).toBeUndefined();
    expect(await ok(main, 'Ada', 'ls')).toContain(`[claimed ${where} by Bob]`);
    expect(await ok(wt2, 'Ada', 'show', '1')).toContain(
      `Elsewhere:  claimed ${where} by Bob (`,
    );
    expect(
      (await json<Listed>(wt2, 'Ada', 'show', '1')).claimedElsewhere,
    ).toMatchObject({ ref: 'agent-1', assignee: 'Bob' });
    // ... but not in the worktree that has the claim.
    expect(await ok(wt1, 'Bob', 'show', '1')).not.toContain('Elsewhere:');
  });

  test('--force takes it over; the newer claim is then seen everywhere', async () => {
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    await ok(wt2, 'Ada', 'claim', '1', '--force');
    expect(await readIssue(wt2, 1)).toMatchObject({
      status: 'in_progress',
      assignee: 'Ada',
    });
    const res = await cli(wt1, 'Bob', 'claim', '1');
    expect(res.code).toBe(EXIT_ALREADY_CLAIMED);
    expect(res.stderr).toContain(
      `claimed by Ada (in_progress) in worktree ${wt2} (branch agent-2)`,
    );
  });

  test('a newer unclaim wins over the claim', async () => {
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    expect((await cli(wt2, 'Ada', 'claim', '1')).code).toBe(
      EXIT_ALREADY_CLAIMED,
    );
    await ok(wt1, 'Bob', 'unclaim', '1', '--no-commit');
    expect(
      (await json<Listed[]>(wt2, 'Ada', 'ready')).map((i) => i.id),
    ).toEqual([1, 2]);
    await ok(wt2, 'Ada', 'claim', '1');
  });

  test('a committed claim on a branch outlives its worktree, until the branch is deleted', async () => {
    await ok(wt1, 'Bob', 'claim', '1');
    await simpleGit(main).raw(['worktree', 'remove', wt1]);
    const res = await cli(main, 'Ada', 'claim', '1');
    expect(res.code).toBe(EXIT_ALREADY_CLAIMED);
    expect(res.stderr).toContain(
      'already claimed by Bob (in_progress) on branch agent-1.',
    );
    expect(await ok(main, 'Ada', 'ls')).toContain(
      '[claimed on branch agent-1 by Bob]',
    );
    await simpleGit(main).raw(['branch', '-D', 'agent-1']);
    await ok(main, 'Ada', 'claim', '1');
  });

  test('agents sharing an identity get different issues from next --claim', async () => {
    const first = await json<Listed>(
      wt1,
      'Ada',
      'next',
      '--claim',
      '--no-commit',
    );
    const second = await json<Listed>(
      wt2,
      'Ada',
      'next',
      '--claim',
      '--no-commit',
    );
    expect([first.id, second.id]).toEqual([1, 2]);
    // My own claim elsewhere is still listed by ready (it's mine).
    expect(
      (await json<Listed[]>(main, 'Ada', 'ready')).map((i) => i.id),
    ).toEqual([1, 2]);
    expect((await cli(main, 'Ada', 'next')).code).toBe(5);
  });
});

/** Regression tests for #65: unclaim judges by the effective state too. */
describe('unclaim across worktrees', () => {
  test('releasing my own claim from main makes it ready again for others', async () => {
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    // Not ready for Ada while Bob holds it in wt-1.
    expect(
      (await json<Listed[]>(wt2, 'Ada', 'ready')).map((i) => i.id),
    ).toEqual([2]);

    const res = await cli(main, 'Bob', 'unclaim', '1');
    expect(res.code).toBe(0);
    expect(res.stderr).toContain(
      `Released the claim by Bob in worktree ${wt1} (branch agent-1)`,
    );
    expect(await readIssue(main, 1)).toMatchObject({
      status: 'todo',
      assignee: '',
    });
    // The other worktree's file is untouched, but superseded.
    expect((await readIssue(wt1, 1)).assignee).toBe('Bob');
    expect(await ok(main, 'Ada', 'ls')).not.toContain('[claimed');

    expect(
      (await json<Listed[]>(wt2, 'Ada', 'ready')).map((i) => i.id),
    ).toEqual([1, 2]);
    expect((await json<Listed>(wt2, 'Ada', 'next')).id).toBe(1);
    await ok(wt2, 'Ada', 'claim', '1');
  });

  test("releasing someone else's claim elsewhere requires --force", async () => {
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    const where = `in worktree ${wt1} (branch agent-1)`;

    const res = await cli(main, 'Ada', 'unclaim', '1');
    expect(res.code).toBe(EXIT_ALREADY_CLAIMED);
    expect(res.stderr).toContain(
      `Error: Issue #1 is claimed by Bob ${where}, not you. Use --force to release it anyway.`,
    );
    const err = await cli(main, 'Ada', '-o', 'json', 'unclaim', '1');
    expect(err.code).toBe(EXIT_ALREADY_CLAIMED);
    expect(JSON.parse(err.stderr).error).toMatchObject({
      code: 'already_claimed',
      assignee: 'Bob',
      claimedElsewhere: { ref: 'agent-1', worktree: wt1, assignee: 'Bob' },
    });
    expect(
      (await json<Listed[]>(wt2, 'Ada', 'ready')).map((i) => i.id),
    ).toEqual([2]);

    await ok(main, 'Ada', 'unclaim', '1', '--force');
    expect(
      (await json<Listed[]>(wt2, 'Ada', 'ready')).map((i) => i.id),
    ).toEqual([1, 2]);
    await ok(wt2, 'Ada', 'claim', '1');
  });

  test('a committed claim on a branch can be released without its worktree', async () => {
    await ok(wt1, 'Bob', 'claim', '1');
    await simpleGit(main).raw(['worktree', 'remove', wt1]);
    expect((await cli(main, 'Ada', 'claim', '1')).code).toBe(
      EXIT_ALREADY_CLAIMED,
    );
    const res = await cli(main, 'Bob', 'unclaim', '1');
    expect(res.code).toBe(0);
    expect(res.stderr).toContain('Released the claim by Bob on branch agent-1');
    await ok(main, 'Ada', 'claim', '1');
  });

  test('unclaiming an issue closed in a newer version elsewhere fails', async () => {
    // git doesn't track the empty closed/ dir, and close doesn't create it.
    await mkdir(join(wt1, '.issues', 'closed'), { recursive: true });
    await ok(wt1, 'Bob', 'close', '1', '--no-commit');
    const res = await cli(main, 'Bob', 'unclaim', '1');
    expect(res.code).toBe(EXIT_ISSUE_CLOSED);
    expect(res.stderr).toContain(
      `Error: Issue #1 is closed (done) in worktree ${wt1} (branch agent-1); nothing to release.`,
    );
    expect((await readIssue(main, 1)).status).toBe('todo');
  });

  test('claim warns when you already hold the issue in another worktree', async () => {
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    const res = await cli(wt2, 'Bob', 'claim', '1', '--no-commit');
    expect(res.code).toBe(0);
    expect(res.stderr).toContain(
      `Warning: you already hold issue #1 in worktree ${wt1} (branch agent-1); claimed it here too.`,
    );
    expect(await readIssue(wt2, 1)).toMatchObject({
      status: 'in_progress',
      assignee: 'Bob',
    });
    // No warning for a plain claim.
    const plain = await cli(wt2, 'Bob', 'claim', '2', '--no-commit');
    expect(plain.stderr).not.toContain('Warning');
  });
});

describe('closes across worktrees and branches (#93)', () => {
  test('claim refuses an issue closed in another worktree unless --force', async () => {
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    // git doesn't track the empty closed/ dir, and close doesn't create it.
    await mkdir(join(wt1, '.issues', 'closed'), { recursive: true });
    await ok(wt1, 'Bob', 'close', '1', '--no-commit');
    const where = `in worktree ${wt1} (branch agent-1)`;

    const res = await cli(main, 'Ada', 'claim', '1');
    expect(res.code).toBe(EXIT_ISSUE_CLOSED);
    expect(res.stderr).toContain(
      `Error: Issue #1 is closed (done) ${where}. Merge that branch to get the close here, or use --force to claim it anyway.`,
    );
    expect(res.stderr).not.toContain('reopen');
    expect(await readIssue(main, 1)).toMatchObject({
      status: 'todo',
      assignee: '',
    });
    const err = await cli(main, 'Ada', '-o', 'json', 'claim', '1');
    expect(err.code).toBe(EXIT_ISSUE_CLOSED);
    expect(JSON.parse(err.stderr).error).toMatchObject({
      code: 'issue_closed',
      status: 'done',
      closedElsewhere: { ref: 'agent-1', worktree: wt1, status: 'done' },
    });

    // ls / show say where it's closed; ready / next skip it.
    const listed = await json<Listed[]>(main, 'Ada', 'ls');
    expect(listed[0]?.closedElsewhere).toMatchObject({
      ref: 'agent-1',
      worktree: wt1,
      status: 'done',
    });
    expect(listed[0]?.claimedElsewhere).toBeUndefined();
    expect(listed[1]?.closedElsewhere).toBeUndefined();
    expect(await ok(main, 'Ada', 'ls')).toContain(`[closed (done) ${where}]`);
    expect(await ok(main, 'Ada', 'show', '1')).toContain(
      `Elsewhere:  closed (done) ${where} (`,
    );
    expect(
      (await json<Listed>(main, 'Ada', 'show', '1')).closedElsewhere,
    ).toMatchObject({ ref: 'agent-1', worktree: wt1, status: 'done' });
    const ready = await json<Listed[]>(main, 'Ada', 'ready');
    expect(ready.map((i) => i.id)).toEqual([2]);

    // --force claims it here; the newer claim supersedes the close.
    await ok(main, 'Ada', 'claim', '1', '--force', '--no-commit');
    expect(await readIssue(main, 1)).toMatchObject({
      status: 'in_progress',
      assignee: 'Ada',
    });
    const after = await json<Listed>(main, 'Ada', 'show', '1');
    expect(after.closedElsewhere).toBeUndefined();
  });

  test('a close committed on a branch is seen after its worktree is gone', async () => {
    await mkdir(join(wt1, '.issues', 'closed'), { recursive: true });
    await ok(wt1, 'Bob', 'close', '1');
    await simpleGit(main).raw(['worktree', 'remove', '--force', wt1]);

    const res = await cli(main, 'Ada', '-o', 'json', 'claim', '1');
    expect(res.code).toBe(EXIT_ISSUE_CLOSED);
    const { error } = JSON.parse(res.stderr);
    expect(error.closedElsewhere).toMatchObject({
      ref: 'agent-1',
      status: 'done',
    });
    expect(error.closedElsewhere).not.toHaveProperty('worktree');
    expect(await ok(main, 'Ada', 'ls')).toContain(
      '[closed (done) on branch agent-1]',
    );
  });

  test('a local close keeps the reopen hint', async () => {
    await mkdir(join(main, '.issues', 'closed'), { recursive: true });
    await ok(main, 'Ada', 'close', '2', '--no-commit');
    const res = await cli(main, 'Ada', 'claim', '2');
    expect(res.code).toBe(EXIT_ISSUE_CLOSED);
    expect(res.stderr).toContain(
      'Error: Issue #2 is closed (done). Use "gitrac reopen 2" first',
    );
  });
});

/** Regression tests for #107: issues created in other worktrees / on branches. */
describe('issues that exist only elsewhere', () => {
  type Found = Listed & {
    title: string;
    foundElsewhere?: { ref: string; worktree?: string };
  };

  test('ls --elsewhere and show see them; mutations still need the local file', async () => {
    // Uncommitted in an agent's worktree.
    await ok(wt1, 'Bob', 'create', '-t', 'Found a bug', '--no-commit');
    // Committed on a branch whose worktree is gone.
    await ok(wt2, 'Cy', 'create', '-t', 'Sub task', '-l', 'chore');
    await simpleGit(main).raw(['worktree', 'remove', wt2]);
    const inWt1 = `in worktree ${wt1} (branch agent-1)`;

    // Without the flag, ls is unchanged.
    expect((await json<Found[]>(main, 'Ada', 'ls')).map((i) => i.id)).toEqual([
      1, 2,
    ]);

    const listed = await json<Found[]>(main, 'Ada', 'ls', '--elsewhere');
    expect(listed.map((i) => [i.id, i.title, i.foundElsewhere])).toEqual([
      [1, 'First', undefined],
      [2, 'Second', undefined],
      [3, 'Found a bug', { ref: 'agent-1', worktree: wt1 }],
      [4, 'Sub task', { ref: 'agent-2' }],
    ]);
    const human = await ok(main, 'Ada', 'ls', '--elsewhere');
    expect(human).toContain(`[only ${inWt1}]`);
    expect(human).toContain('[only on branch agent-2]');
    // Filters apply to them too.
    expect(
      (
        await json<Found[]>(
          main,
          'Ada',
          'ls',
          '--elsewhere',
          '--label',
          'chore',
        )
      ).map((i) => i.id),
    ).toEqual([4]);
    expect(
      (
        await json<Found[]>(main, 'Ada', 'ls', '--elsewhere', '--search', 'bug')
      ).map((i) => i.id),
    ).toEqual([3]);

    // show: the version elsewhere, with a note on stderr.
    const shown = await cli(main, 'Ada', 'show', '3');
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain('# #3: Found a bug');
    expect(shown.stdout).toContain(`Elsewhere:  only ${inWt1}\n`);
    expect(shown.stderr).toContain(
      `Note: issue #3 is not in this working tree; showing the version ${inWt1}.`,
    );
    const shownJson = await json<Found>(main, 'Ada', 'show', '4');
    expect(shownJson).toMatchObject({
      id: 4,
      title: 'Sub task',
      foundElsewhere: { ref: 'agent-2' },
    });
    expect(shownJson.foundElsewhere).not.toHaveProperty('worktree');
    // Nowhere at all: still not_found (exit 5).
    expect((await cli(main, 'Ada', 'show', '9')).code).toBe(5);

    // Mutations are unchanged: they need the local file.
    expect((await cli(main, 'Ada', 'claim', '3')).code).toBe(5);
    expect((await cli(main, 'Ada', 'close', '4')).code).toBe(5);
  });

  test('an issue that also exists locally is not duplicated', async () => {
    // #1 edited (newer) in an agent's worktree: listed once, as the local one.
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    const listed = await json<Found[]>(main, 'Ada', 'ls', '--elsewhere');
    expect(listed.map((i) => i.id)).toEqual([1, 2]);
    expect(listed[0]?.foundElsewhere).toBeUndefined();
    expect(listed[0]?.claimedElsewhere).toMatchObject({ ref: 'agent-1' });
    // Its show is the local one, without a note.
    const shown = await cli(main, 'Ada', 'show', '1');
    expect(shown.stderr).not.toContain('Note:');
  });
});

/** Regression tests for #105: an issue in review stays claimed elsewhere. */
describe('review handoff across worktrees (#105)', () => {
  /** Add a `review` status and set it as `reviewStatus` in `dir`'s config. */
  async function enableReview(dir: string) {
    const config = await readConfig(dir);
    config.statuses.splice(3, 0, { name: 'review', closed: false });
    config.reviewStatus = 'review';
    await writeConfig(dir, config);
  }

  test('an agent hands off in its worktree; main still sees the claim', async () => {
    for (const dir of [main, wt1, wt2]) await enableReview(dir);
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    await ok(wt1, 'Bob', 'review', '1', '--no-commit', '-c', 'please review');
    expect(await readIssue(wt1, 1)).toMatchObject({
      status: 'review',
      assignee: 'Bob',
    });
    const where = `in worktree ${wt1} (branch agent-1)`;

    // Still shown as claimed elsewhere.
    const listed = await json<Listed[]>(main, 'Ada', 'ls');
    expect(listed[0]?.claimedElsewhere).toMatchObject({
      ref: 'agent-1',
      worktree: wt1,
      assignee: 'Bob',
    });
    expect(await ok(main, 'Ada', 'ls')).toContain(`[claimed ${where} by Bob]`);

    // claim refuses; ready / next skip it.
    const res = await cli(main, 'Ada', 'claim', '1');
    expect(res.code).toBe(EXIT_ALREADY_CLAIMED);
    expect(res.stderr).toContain(
      `Error: Issue #1 is already claimed by Bob (review) ${where}.`,
    );
    expect(
      (await json<Listed[]>(main, 'Ada', 'ready')).map((i) => i.id),
    ).toEqual([2]);
    expect((await json<Listed>(main, 'Ada', 'next')).id).toBe(2);
    // The assignee's own `next` skips it too.
    expect((await json<Listed>(wt2, 'Bob', 'next')).id).toBe(2);

    // unclaim --force releases it.
    expect((await cli(main, 'Ada', 'unclaim', '1')).code).toBe(
      EXIT_ALREADY_CLAIMED,
    );
    await ok(main, 'Ada', 'unclaim', '1', '--force');
    expect(await readIssue(main, 1)).toMatchObject({
      status: 'todo',
      assignee: '',
    });
    expect(
      (await json<Listed[]>(main, 'Ada', 'ready')).map((i) => i.id),
    ).toEqual([1, 2]);
  });

  test('claim by the assignee sends it back to in_progress (rework)', async () => {
    await enableReview(wt1);
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    await ok(wt1, 'Bob', 'review', '1', '--no-commit');
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    expect((await readIssue(wt1, 1)).status).toBe('in_progress');
  });

  test('review needs a configured reviewStatus and a claimed issue', async () => {
    const none = await cli(main, 'Ada', '-o', 'json', 'review', '1');
    expect(none.code).toBe(2);
    expect(JSON.parse(none.stderr).error).toMatchObject({
      code: 'invalid_input',
    });
    expect(none.stderr).toContain('reviewStatus');

    await enableReview(main);
    const unclaimed = await cli(main, 'Ada', 'review', '1');
    expect(unclaimed.code).toBe(3);
    expect(unclaimed.stderr).toContain('Use "gitrac claim 1" first.');
  });
});

/** Regression tests for #106: stale claims of crashed or timed-out agents. */
describe('stale claims across worktrees (#106)', () => {
  const HOUR = 60 * 60 * 1000;

  /** Set issue `id`'s `updated` in `dir` to `hours` ago (an idle agent). */
  async function age(dir: string, id: number, hours: number): Promise<string> {
    const issue = await readIssue(dir, id);
    issue.updated = new Date(Date.now() - hours * HOUR).toISOString();
    await writeIssue(dir, issue);
    return issue.updated;
  }

  // The issues were created long before the claims: age every copy, so an
  // idle claim is still newer than the unclaimed versions.
  beforeEach(async () => {
    for (const dir of [main, wt1, wt2]) {
      for (const id of [1, 2]) await age(dir, id, 10);
    }
  });

  test('ls --stale lists an idle agent claim; next --claim --stale takes it over', async () => {
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    await ok(wt2, 'Cy', 'claim', '2', '--no-commit');
    const updated = await age(wt1, 1, 3);
    const where = { ref: 'agent-1', worktree: wt1, assignee: 'Bob', updated };

    // Only the stale claim is listed (the fresh one is not).
    const listed = await json<Listed[]>(main, 'Ada', 'ls', '--stale', '2h');
    expect(listed.map((i) => i.id)).toEqual([1]);
    expect(listed[0]?.staleClaim).toEqual(where);
    expect(await ok(main, 'Ada', 'ls', '--stale', '2h')).toContain(
      `[stale claim by Bob, last activity ${updated}]`,
    );
    expect(
      (await json<Listed[]>(main, 'Ada', 'ls', '--stale', '4h')).length,
    ).toBe(0);
    // Without --stale, ls is unchanged.
    expect(
      (await json<Listed[]>(main, 'Ada', 'ls')).map((i) => i.staleClaim),
    ).toEqual([undefined, undefined]);

    // ready / next: available only with --stale.
    expect((await cli(main, 'Ada', 'next')).code).toBe(5);
    const ready = await json<Listed[]>(main, 'Ada', 'ready', '--stale', '2h');
    expect(ready.map((i) => i.id)).toEqual([1]);
    expect(ready[0]?.staleClaim).toEqual(where);
    expect((await json<Listed>(main, 'Ada', 'next', '--stale', '2h')).id).toBe(
      1,
    );

    const taken = await cli(
      main,
      'Ada',
      '-o',
      'json',
      'next',
      '--claim',
      '--stale',
      '2h',
      '--no-commit',
    );
    expect(taken.code).toBe(0);
    expect(JSON.parse(taken.stdout)).toMatchObject({
      id: 1,
      assignee: 'Ada',
      status: 'in_progress',
    });
    expect(taken.stderr).toContain(
      `Took over the stale claim by Bob on issue #1 (last activity ${updated}).`,
    );
    // Now Ada's claim is the effective one; the fresh #2 is never taken.
    expect((await cli(wt1, 'Bob', 'claim', '1')).code).toBe(
      EXIT_ALREADY_CLAIMED,
    );
    expect(
      (await cli(main, 'Ada', 'next', '--claim', '--stale', '2h')).code,
    ).toBe(5);
    expect((await readIssue(wt2, 2)).assignee).toBe('Cy');
  });

  test('unclaim --stale releases a stale claim only', async () => {
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    await ok(wt2, 'Cy', 'claim', '2', '--no-commit');
    await age(wt1, 1, 3);

    // A fresh claim: refused, with its age.
    const fresh = await cli(main, 'Ada', 'unclaim', '2', '--stale', '2h');
    expect(fresh.code).toBe(EXIT_ALREADY_CLAIMED);
    expect(fresh.stderr).toContain(
      `Error: Issue #2 is claimed by Cy in worktree ${wt2} (branch agent-2), not you. Its last activity was 0s ago, less than 2h.`,
    );

    const res = await cli(main, 'Ada', 'unclaim', '1', '--stale', '2h');
    expect(res.code).toBe(0);
    expect(res.stderr).toContain('Released the stale claim by Bob');
    expect(await readIssue(main, 1)).toMatchObject({
      status: 'todo',
      assignee: '',
    });
    expect(
      (await json<Listed[]>(main, 'Ada', 'ready')).map((i) => i.id),
    ).toEqual([1]);
  });

  test('a claim in the review status is never stale', async () => {
    for (const dir of [main, wt1]) {
      const config = await readConfig(dir);
      config.statuses.splice(3, 0, { name: 'review', closed: false });
      config.reviewStatus = 'review';
      await writeConfig(dir, config);
    }
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    await ok(wt1, 'Bob', 'review', '1', '--no-commit');
    await age(wt1, 1, 5);

    expect(
      (await json<Listed[]>(main, 'Ada', 'ls', '--stale', '2h')).length,
    ).toBe(0);
    expect(
      (await json<Listed[]>(main, 'Ada', 'ready', '--stale', '2h')).map(
        (i) => i.id,
      ),
    ).toEqual([2]);
    const res = await cli(main, 'Ada', 'unclaim', '1', '--stale', '2h');
    expect(res.code).toBe(EXIT_ALREADY_CLAIMED);
    expect(res.stderr).toContain('A claim in review is never stale.');
  });

  test('claim --renew in the worktree makes the claim fresh again', async () => {
    await ok(wt1, 'Bob', 'claim', '1', '--no-commit');
    await age(wt1, 1, 3);
    expect(
      (await json<Listed[]>(main, 'Ada', 'ls', '--stale', '2h')).map(
        (i) => i.id,
      ),
    ).toEqual([1]);

    const renew = await cli(wt1, 'Bob', '--no-commit', 'claim', '1', '--renew');
    expect(renew.code).toBe(0);
    expect(renew.stderr).toContain('Renewed your claim on issue #1.');
    expect(
      (await json<Listed[]>(main, 'Ada', 'ls', '--stale', '2h')).length,
    ).toBe(0);
    // next skips the renewed claim (it picks the free #2).
    expect((await json<Listed>(main, 'Ada', 'next', '--stale', '2h')).id).toBe(
      2,
    );
    expect(await readIssue(wt1, 1)).toMatchObject({
      assignee: 'Bob',
      status: 'in_progress',
    });
  });

  test('a bad duration is invalid_input (exit 2)', async () => {
    for (const args of [
      ['ls', '--stale', '2x'],
      ['ready', '--stale', ''],
      ['next', '--stale', '0h'],
      ['unclaim', '1', '--stale', '1.5h'],
    ]) {
      const res = await cli(main, 'Ada', '-o', 'json', ...args);
      expect({ args, code: res.code }).toEqual({ args, code: 2 });
      expect(JSON.parse(res.stderr).error.code).toBe('invalid_input');
    }
  });
});
