import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { initIssuesDir } from '../fs/issue-store.ts';
import { initProject } from './config.ts';
import { installMergeDriver } from './merge-driver.ts';
import { type ServiceFixture, serviceFixture } from './test-helpers.fixture.ts';

const ATTRIBUTES = join('.issues', '.gitattributes');

describe('installMergeDriver (no git repo)', () => {
  let fx: ServiceFixture;
  beforeEach(async () => {
    fx = await serviceFixture();
  });
  afterEach(() => fx.cleanup());

  test('writes and commits .gitattributes once', async () => {
    const first = await installMergeDriver(fx.context(), { command: 'gitrac' });
    expect(first).toMatchObject({
      command: 'gitrac',
      configured: false,
      paths: [ATTRIBUTES],
      commit: 'abc123',
    });
    expect(fx.commits[0]).toMatchObject({
      operation: 'merge-driver',
      files: [ATTRIBUTES],
      message: 'issue: install merge driver',
    });

    const again = await installMergeDriver(fx.context(), { command: 'gitrac' });
    expect(again).toMatchObject({ paths: [], commit: null });
    expect(fx.commits).toHaveLength(1);
  });

  test('respects noCommit', async () => {
    const result = await installMergeDriver(fx.context({ noCommit: true }), {
      command: 'gitrac',
    });
    expect(result).toMatchObject({ paths: [ATTRIBUTES], commit: null });
    expect(fx.commits).toHaveLength(0);
  });
});

describe('merge driver git config', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gitrac-service-md-'));
    await simpleGit(dir).init();
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const context = (noCommit = true) => ({
    dir,
    identity: async () => ({ name: 'Ada', email: 'ada@example.com' }),
    noCommit,
  });

  test('installMergeDriver defines merge.gitrac.driver', async () => {
    await initIssuesDir(dir);
    const result = await installMergeDriver(context(), {
      command: '/opt/gitrac',
    });
    expect(result.configured).toBe(true);
    const { value } = await simpleGit(dir).getConfig(
      'merge.gitrac.driver',
      'local',
    );
    expect(value).toBe('/opt/gitrac merge-driver --marker-size %L %O %A %B %P');
  });

  test('init installs the driver too', async () => {
    await initProject(context(), { mergeDriverCommand: 'gitrac' });
    const { value } = await simpleGit(dir).getConfig(
      'merge.gitrac.driver',
      'local',
    );
    expect(value).toBe('gitrac merge-driver --marker-size %L %O %A %B %P');
    expect(await Bun.file(join(dir, ATTRIBUTES)).exists()).toBe(true);
  });
});
