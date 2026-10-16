import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import simpleGit from 'simple-git';
import { EXIT_INVALID_INPUT } from '../../core/errors.ts';
import type { Issue } from '../../core/types.ts';
import { readConfig, writeConfig, writeIssue } from '../../fs/issue-store.ts';
import { AmendTracker } from '../../git/amend-tracker.ts';
import { IdentityResolver } from '../../git/identity.ts';
import { issueRoutes } from '../../web/routes/issues.ts';
import { IssueWatcher } from '../../web/watcher.ts';

/** Regression tests for #52: `ls` filters, search, --mine, labels column. */

setDefaultTimeout(30_000);

const ENTRY = join(import.meta.dir, '..', '..', '..', 'index.ts');

let dir: string;

async function cli(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, ENTRY, '--dir', dir, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

async function cliIds(...args: string[]): Promise<number[]> {
  const res = await cli('ls', '-o', 'json', ...args);
  expect(res.code).toBe(0);
  return (JSON.parse(res.stdout) as Issue[]).map((i) => i.id);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: 1,
    title: 'An issue',
    status: 'todo',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2025-01-01T00:00:00Z',
    createdBy: 'tester',
    updated: '2025-01-01T00:00:00Z',
    description: '',
    comments: [],
    ...overrides,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-list-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'Justin@Example.com');
  await git.addConfig('user.name', 'Justin Murray');
  await git.addConfig('commit.gpgsign', 'false');
  await Bun.write(join(dir, 'README.md'), 'hello');
  await git.add('.');
  await git.commit('initial');
  expect((await cli('init')).code).toBe(0);

  const config = await readConfig(dir);
  config.assignees = [{ name: 'Justin Murray', email: 'justin@example.com' }];
  await writeConfig(dir, config);
  await writeIssue(
    dir,
    issue({
      id: 1,
      title: 'Fix login timeout',
      priority: 'urgent',
      assignee: 'justin@example.com',
      labels: ['bug', 'auth'],
      description: 'Sessions expire too early.',
    }),
  );
  await writeIssue(
    dir,
    issue({
      id: 2,
      title: 'Dark mode',
      status: 'backlog',
      priority: 'low',
      assignee: 'Alice',
      labels: ['feature'],
    }),
  );
  await writeIssue(
    dir,
    issue({
      id: 4,
      title: 'Refactor',
      status: 'in_progress',
      priority: 'high',
    }),
  );
  await writeIssue(
    dir,
    issue({ id: 3, title: 'Login docs', status: 'done', priority: 'high' }),
    { closed: true },
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('gitrac ls filters', () => {
  test('comma-separated priority / status / label', async () => {
    expect(await cliIds('--priority', 'urgent,high')).toEqual([1, 4]);
    expect(await cliIds('--status', 'todo,done')).toEqual([1, 3]);
    expect(await cliIds('--label', 'auth,feature')).toEqual([1, 2]);
    expect(await cliIds('--status', 'all', '--priority', 'high')).toEqual([
      3, 4,
    ]);
  });

  test('--assignee matches name or email, case-insensitively', async () => {
    expect(await cliIds('--assignee', 'justin murray')).toEqual([1]);
    expect(await cliIds('--assignee', 'JUSTIN@example.com')).toEqual([1]);
    expect(await cliIds('--assignee', 'alice')).toEqual([2]);
  });

  test('--mine uses the git identity (or --author)', async () => {
    expect(await cliIds('--mine')).toEqual([1]);
    expect(await cliIds('--author', 'Alice', '--mine')).toEqual([2]);
  });

  test('--search over title and description', async () => {
    expect(await cliIds('--search', 'login')).toEqual([1]);
    expect(await cliIds('--search', 'login', '--status', 'all')).toEqual([
      1, 3,
    ]);
    expect(await cliIds('--search', 'SESSIONS expire')).toEqual([1]);
  });

  test('invalid status / priority / sort exit 2', async () => {
    for (const args of [
      ['--status', 'todo,nope'],
      ['--priority', 'meh'],
      ['--sort', 'color'],
    ]) {
      const res = await cli('ls', ...args);
      expect(res.code).toBe(EXIT_INVALID_INPUT);
      expect(res.stdout).toBe('');
    }
  });

  test('human output shows labels', async () => {
    const res = await cli('ls');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Labels');
    expect(res.stdout).toContain('bug, auth');
  });

  test('CLI and GET /api/issues return the same issues', async () => {
    const app = new Hono();
    app.route(
      '/api',
      issueRoutes({
        dir,
        config: await readConfig(dir),
        amendTracker: new AmendTracker(),
        watcher: new IssueWatcher(dir),
        identity: new IdentityResolver(dir),
      }),
    );
    const cases: [string[], string][] = [
      [[], ''],
      [['--status', 'all'], 'status=all'],
      [['--status', 'backlog,done'], 'status=backlog,done'],
      [['--priority', 'urgent,high'], 'priority=urgent&priority=high'],
      [['--label', 'bug'], 'label=bug'],
      [['--assignee', 'Justin Murray'], 'assignee=Justin%20Murray'],
      [['--mine'], 'mine=1'],
      [['--search', 'login', '--status', 'all'], 'search=login&status=all'],
      [['--sort', 'priority', '--status', 'all'], 'sort=priority&status=all'],
      [['--sort', 'updated'], 'sort=updated'],
    ];
    for (const [args, qs] of cases) {
      const res = await app.request(`http://localhost/api/issues?${qs}`);
      expect(res.status).toBe(200);
      const web = ((await res.json()) as Issue[]).map((i) => i.id);
      expect({ args, ids: await cliIds(...args) }).toEqual({ args, ids: web });
    }
    const bad = await app.request('http://localhost/api/issues?status=nope');
    expect(bad.status).toBe(400);
  });
});

describe('issue files in the wrong directory (#97)', () => {
  // After a merge: open status in closed/, closed status in .issues/.
  const OPEN_IN_CLOSED = join('.issues', 'closed', '5-merged-open.md');
  const CLOSED_IN_OPEN = join('.issues', '6-merged-closed.md');

  beforeEach(async () => {
    await writeIssue(dir, issue({ id: 5, title: 'Merged open' }), {
      closed: true,
    });
    await writeIssue(
      dir,
      issue({ id: 6, title: 'Merged closed', status: 'done' }),
    );
  });

  test('ls filters by status, not directory', async () => {
    expect(await cliIds()).toEqual([1, 2, 4, 5]);
    expect(await cliIds('--status', 'done')).toEqual([3, 6]);
    expect(await cliIds('--status', 'all')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('ls warns about each misplaced file on stderr', async () => {
    const res = await cli('ls', '-o', 'json');
    expect(res.code).toBe(0);
    for (const path of [OPEN_IN_CLOSED, CLOSED_IN_OPEN]) {
      expect(res.stderr).toContain(
        `Warning: issue file ${path} is in the wrong directory for its status`,
      );
    }
    expect(res.stdout).not.toContain('Warning');
  });

  test('GET /api/issues lists the same issues', async () => {
    const app = new Hono();
    app.route(
      '/api',
      issueRoutes({
        dir,
        config: await readConfig(dir),
        amendTracker: new AmendTracker(),
        watcher: new IssueWatcher(dir),
        identity: new IdentityResolver(dir),
      }),
    );
    for (const [args, qs] of [
      [[], ''],
      [['--status', 'done'], 'status=done'],
      [['--status', 'all'], 'status=all'],
    ] as [string[], string][]) {
      const res = await app.request(`http://localhost/api/issues?${qs}`);
      const web = ((await res.json()) as Issue[]).map((i) => i.id);
      expect(web).toEqual(await cliIds(...args));
    }
  });

  test('a later edit moves the file to the right directory', async () => {
    expect((await cli('edit', '5', '-p', 'high')).code).toBe(0);
    expect((await cli('comment', '6', 'Noted.')).code).toBe(0);
    expect(await exists(join(dir, OPEN_IN_CLOSED))).toBe(false);
    expect(await exists(join(dir, '.issues', '5-merged-open.md'))).toBe(true);
    expect(await exists(join(dir, CLOSED_IN_OPEN))).toBe(false);
    expect(
      await exists(join(dir, '.issues', 'closed', '6-merged-closed.md')),
    ).toBe(true);
    const res = await cli('ls');
    expect(res.stderr).not.toContain('wrong directory');
    expect(await cliIds()).toEqual([1, 2, 4, 5]);
  });
});
