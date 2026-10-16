import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import type { Issue } from '../core/types.ts';
import { initIssuesDir, writeIssue } from '../fs/issue-store.ts';
import { issueStatesElsewhere } from './elsewhere.ts';

/** Regression tests for #56: issue versions on other worktrees / branches. */

let tmp: string;
let repo: string;

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 1,
    title: 'Shared',
    status: 'todo',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2026-01-01T00:00:00Z',
    createdBy: 'tester',
    updated: '2026-01-01T00:00:00Z',
    description: '',
    comments: [],
    ...overrides,
  };
}

const CLAIMED = {
  status: 'in_progress' as const,
  assignee: 'bob@example.com',
  updated: '2026-01-02T00:00:00Z',
};

async function initRepo(path: string, project = path): Promise<void> {
  await mkdir(project, { recursive: true });
  const git = simpleGit(path);
  await git.raw(['init', '-b', 'main']);
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await initIssuesDir(project);
  await writeIssue(project, makeIssue());
  await writeIssue(project, makeIssue({ id: 2, title: 'Other' }));
  await git.add('.');
  await git.commit('init');
}

async function commitAll(path: string, message: string): Promise<void> {
  const git = simpleGit(path);
  await git.add('.');
  await git.commit(message);
}

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), 'gitrac-elsewhere-')));
  repo = join(tmp, 'repo');
  await initRepo(repo);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('issueStatesElsewhere', () => {
  test('nothing elsewhere: empty', async () => {
    // A branch at the same commit adds nothing (same blobs as HEAD).
    await simpleGit(repo).branch(['same']);
    expect((await issueStatesElsewhere(repo)).size).toBe(0);
  });

  test("sees an uncommitted claim in another worktree's working tree", async () => {
    const wt = join(tmp, 'wt-1');
    await simpleGit(repo).raw(['worktree', 'add', '-b', 'agent-1', wt]);
    await writeIssue(wt, makeIssue(CLAIMED));

    // (Worktrees' files are read whether or not they differ.)
    expect((await issueStatesElsewhere(repo)).get(1)).toEqual([
      { ref: 'agent-1', worktree: wt, ...CLAIMED },
    ]);
    // The other worktree sees the main working tree's (older) version; the
    // `main` branch is the same as its HEAD.
    expect(await issueStatesElsewhere(wt, { ids: [1] })).toEqual(
      new Map([
        [
          1,
          [
            {
              ref: 'main',
              worktree: repo,
              status: 'todo',
              assignee: '',
              updated: '2026-01-01T00:00:00Z',
            },
          ],
        ],
      ]),
    );
  });

  test('sees a committed claim in another worktree, worktree first', async () => {
    const wt = join(tmp, 'wt-1');
    await simpleGit(repo).raw(['worktree', 'add', '-b', 'agent-1', wt]);
    await writeIssue(wt, makeIssue(CLAIMED));
    await commitAll(wt, 'claim');

    expect((await issueStatesElsewhere(repo)).get(1)).toEqual([
      { ref: 'agent-1', worktree: wt, ...CLAIMED },
      { ref: 'agent-1', ...CLAIMED },
    ]);
    // From the claiming worktree: main's version (older) only.
    expect((await issueStatesElsewhere(wt)).get(1)).toEqual([
      {
        ref: 'main',
        worktree: repo,
        status: 'todo',
        assignee: '',
        updated: '2026-01-01T00:00:00Z',
      },
      {
        ref: 'main',
        status: 'todo',
        assignee: '',
        updated: '2026-01-01T00:00:00Z',
      },
    ]);
  });

  test('sees a claim committed on a branch not checked out anywhere', async () => {
    const git = simpleGit(repo);
    await git.checkoutLocalBranch('agent-2');
    await writeIssue(repo, makeIssue(CLAIMED));
    await commitAll(repo, 'claim');
    await git.checkout('main');

    expect(await issueStatesElsewhere(repo)).toEqual(
      new Map([[1, [{ ref: 'agent-2', ...CLAIMED }]]]),
    );
  });

  test('reads closed/ and filters by ID', async () => {
    const git = simpleGit(repo);
    await git.checkoutLocalBranch('done');
    await git.raw(['rm', '-q', '.issues/2-other.md']);
    const closed = { status: 'done' as const, updated: '2026-01-03T00:00:00Z' };
    await writeIssue(repo, makeIssue({ id: 2, title: 'Other', ...closed }), {
      closed: true,
    });
    await writeIssue(repo, makeIssue(CLAIMED));
    await commitAll(repo, 'close');
    await git.checkout('main');

    const all = await issueStatesElsewhere(repo);
    expect([...all.keys()].sort()).toEqual([1, 2]);
    expect(await issueStatesElsewhere(repo, { ids: [2] })).toEqual(
      new Map([[2, [{ ref: 'done', assignee: '', ...closed }]]]),
    );
    expect((await issueStatesElsewhere(repo, { ids: [] })).size).toBe(0);
  });

  test('sees remote-tracking branches', async () => {
    const git = simpleGit(repo);
    await git.checkoutLocalBranch('theirs');
    await writeIssue(repo, makeIssue(CLAIMED));
    await commitAll(repo, 'claim');
    await git.checkout('main');
    const clone = join(tmp, 'clone');
    await simpleGit(tmp).clone(repo, clone);

    // Only `main` is checked out; the claim lives on origin/theirs.
    expect(await issueStatesElsewhere(clone)).toEqual(
      new Map([[1, [{ ref: 'origin/theirs', ...CLAIMED }]]]),
    );
  });

  test('a detached worktree is reported as HEAD', async () => {
    const wt = join(tmp, 'wt-detached');
    await simpleGit(repo).raw(['worktree', 'add', '--detach', wt]);
    await writeIssue(wt, makeIssue(CLAIMED));
    expect((await issueStatesElsewhere(repo)).get(1)).toEqual([
      { ref: 'HEAD', worktree: wt, ...CLAIMED },
    ]);
  });

  test('a project in a subdirectory of the repo', async () => {
    const root = join(tmp, 'mono');
    await initRepo(root, join(root, 'app'));
    const wt = join(tmp, 'mono-wt');
    await simpleGit(root).raw(['worktree', 'add', '-b', 'agent-1', wt]);
    await writeIssue(join(wt, 'app'), makeIssue(CLAIMED));
    await commitAll(wt, 'claim');

    expect((await issueStatesElsewhere(join(root, 'app'))).get(1)).toEqual([
      { ref: 'agent-1', worktree: wt, ...CLAIMED },
      { ref: 'agent-1', ...CLAIMED },
    ]);
  });

  test('withIssues keeps the parsed issue of each version (#107)', async () => {
    const wt = join(tmp, 'wt-1');
    await simpleGit(repo).raw(['worktree', 'add', '-b', 'agent-1', wt]);
    const created = makeIssue({ id: 3, title: 'New', ...CLAIMED });
    await writeIssue(wt, created);
    await commitAll(wt, 'create #3');

    const states = await issueStatesElsewhere(repo, { withIssues: true });
    expect(states.get(3)).toEqual([
      { ref: 'agent-1', worktree: wt, ...CLAIMED, issue: created },
      { ref: 'agent-1', ...CLAIMED, issue: created },
    ]);
    // Without it, no issue (as before).
    expect((await issueStatesElsewhere(repo)).get(3)?.[0]).not.toHaveProperty(
      'issue',
    );
  });

  test('outside a git repo: empty', async () => {
    const plain = join(tmp, 'plain');
    await mkdir(plain);
    await initIssuesDir(plain);
    expect((await issueStatesElsewhere(plain)).size).toBe(0);
  });
});
