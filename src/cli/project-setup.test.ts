import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { CONFIG_VERSION } from '../core/config.ts';
import { readConfig, writeConfig } from '../fs/issue-store.ts';

/**
 * Regression tests for #127: every command migrates an older `.issues/`
 * once, and warns about a newer one.
 */

setDefaultTimeout(30_000);

const ENTRY = join(import.meta.dir, '..', '..', 'index.ts');

let dir: string;

async function cli(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
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

async function setVersion(version: number): Promise<void> {
  const config = await readConfig(dir);
  config.version = version;
  await writeConfig(dir, config);
  await simpleGit(dir).add('.');
  await simpleGit(dir).commit(`config version ${version}`);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-setup-'));
  const git = simpleGit(dir);
  await git.init(['--initial-branch=main']);
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  expect((await cli('init')).code).toBe(0);
  expect((await cli('create', '-t', 'First')).code).toBe(0);
  expect((await cli('create', '-t', 'Second')).code).toBe(0);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('an older .issues/', () => {
  test('is migrated by the next command, in its own commit, once', async () => {
    const path = join(dir, '.issues', '2-second.md');
    await writeFile(
      path,
      (await readFile(path, 'utf-8')).replace(
        'labels: []\n',
        'labels: []\nblockedBy:\n  - 1\n',
      ),
    );
    await setVersion(1);

    const res = await cli('ls', '-o', 'json');
    expect(res.code).toBe(0);
    expect(res.stderr).toContain(
      `Migrated .issues from version 1 to ${CONFIG_VERSION} (1 issue file rewritten, committed`,
    );
    expect(JSON.parse(res.stdout)[1].links).toEqual([
      { type: 'issue', relationship: 'blockedBy', id: 1 },
    ]);
    expect((await subjects())[0]).toBe(
      `issue: migrate .issues to version ${CONFIG_VERSION}`,
    );
    expect(await readFile(path, 'utf-8')).toContain('relationship: blockedBy');
    expect((await simpleGit(dir).status()).isClean()).toBe(true);

    const again = await cli('ls');
    expect(again.stderr).not.toContain('Migrated');
    expect((await subjects())[0]).toBe(
      `issue: migrate .issues to version ${CONFIG_VERSION}`,
    );
  });
});

describe('a newer .issues/', () => {
  test('every command warns on stderr, and nothing is migrated', async () => {
    await setVersion(CONFIG_VERSION + 1);
    for (const args of [['ls'], ['show', '1', '-o', 'json']]) {
      const res = await cli(...args);
      expect(res.code).toBe(0);
      expect(res.stderr).toContain(
        `Warning: .issues/config.yaml is version ${CONFIG_VERSION + 1}, but this gitrac only knows version ${CONFIG_VERSION}.`,
      );
      expect(res.stdout).not.toContain('Warning');
    }
    expect((await subjects())[0]).toBe(`config version ${CONFIG_VERSION + 1}`);
  });
});
