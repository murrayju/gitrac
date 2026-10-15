import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { AmendTracker } from '../git/amend-tracker.ts';
import { amendStrategy, type CommitRequest } from './commit.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-service-commit-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await Bun.write(join(dir, 'README.md'), 'hello');
  await git.add('.');
  await git.commit('initial');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function request(overrides: Partial<CommitRequest>): CommitRequest {
  return {
    dir,
    operation: 'update',
    issueId: 1,
    files: ['a.md'],
    message: 'msg',
    ...overrides,
  };
}

async function subjects(): Promise<string[]> {
  return (await simpleGit(dir).log()).all.map((e) => e.message);
}

describe('amendStrategy', () => {
  test('a create starts an amendable commit that later edits fold into', async () => {
    const tracker = new AmendTracker();
    const commit = amendStrategy(tracker);

    await Bun.write(join(dir, 'a.md'), 'one');
    const hash = await commit(
      request({ operation: 'create', message: 'create #1' }),
    );
    expect(hash).toBeTruthy();

    await Bun.write(join(dir, 'a.md'), 'two');
    expect(await commit(request({ message: 'update #1' }))).toBeNull();

    expect(await subjects()).toEqual(['create #1 (+ edits)', 'initial']);
  });

  test('config-only changes are plain commits that are never amended', async () => {
    const tracker = new AmendTracker();
    const commit = amendStrategy(tracker);

    await Bun.write(join(dir, 'c.yaml'), 'x: 1');
    await commit(
      request({
        operation: 'label-colors',
        issueId: null,
        files: ['c.yaml'],
        message: 'update label colors',
      }),
    );
    await Bun.write(join(dir, 'a.md'), 'one');
    await commit(request({ message: 'update #1' }));

    expect(await subjects()).toEqual([
      'update #1',
      'update label colors',
      'initial',
    ]);
  });
});
