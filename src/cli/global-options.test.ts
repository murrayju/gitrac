import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import simpleGit from 'simple-git';
import { readConfig, writeConfig } from '../fs/issue-store.ts';
import { getGlobalOptions } from './global-options.ts';
import { createProgram } from './index.ts';

/**
 * Build the real program, but replace every action with a no-op so we can
 * observe how Commander parses the global options.
 */
function parseOnly(args: string[]): Command {
  const program = createProgram();
  program.action(() => {});
  for (const cmd of program.commands) {
    cmd.action(() => {});
  }
  program.exitOverride();
  program.parse(['node', 'gitrac', ...args]);
  return program;
}

describe('getGlobalOptions (real Commander parsing)', () => {
  test('defaults: commit enabled, push deferred to config', () => {
    const opts = getGlobalOptions(parseOnly(['ls']));
    expect(opts.commit).toBe(true);
    expect(opts.push).toBeUndefined();
    expect(opts.output).toBe('human');
    expect(opts.author).toBe('');
    expect(opts.dir).toBe(process.cwd());
    expect(opts.port).toBe(3000);
  });

  test('--no-commit before the subcommand disables commit', () => {
    const opts = getGlobalOptions(parseOnly(['--no-commit', 'close', '1']));
    expect(opts.commit).toBe(false);
  });

  test('--no-commit after the subcommand disables commit', () => {
    const opts = getGlobalOptions(parseOnly(['close', '1', '--no-commit']));
    expect(opts.commit).toBe(false);
  });

  test('--push forces push', () => {
    expect(getGlobalOptions(parseOnly(['--push', 'ls'])).push).toBe(true);
    expect(getGlobalOptions(parseOnly(['close', '1', '--push'])).push).toBe(
      true,
    );
  });

  test('--no-push forces no push', () => {
    expect(getGlobalOptions(parseOnly(['--no-push', 'ls'])).push).toBe(false);
    expect(getGlobalOptions(parseOnly(['close', '1', '--no-push'])).push).toBe(
      false,
    );
  });

  test('last of --push / --no-push wins', () => {
    expect(
      getGlobalOptions(parseOnly(['--push', '--no-push', 'ls'])).push,
    ).toBe(false);
    expect(
      getGlobalOptions(parseOnly(['--no-push', '--push', 'ls'])).push,
    ).toBe(true);
  });

  test('reads --dir, --author, -o, --port', () => {
    const opts = getGlobalOptions(
      parseOnly([
        '--dir',
        '/tmp/x',
        '--author',
        'Bob',
        '-o',
        'json',
        '--port',
        '4000',
        'ls',
      ]),
    );
    expect(opts.dir).toBe('/tmp/x');
    expect(opts.author).toBe('Bob');
    expect(opts.output).toBe('json');
    expect(opts.port).toBe(4000);
  });
});

// --- End-to-end: run real commands through Commander in a scratch repo ---

describe('end-to-end through Commander', () => {
  let dir: string;
  let remoteDir: string | null;
  let logSpy: ReturnType<typeof spyOn>;

  async function run(...args: string[]): Promise<void> {
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync([
      'node',
      'gitrac',
      '--dir',
      dir,
      '--author',
      'Tester',
      ...args,
    ]);
  }

  async function commitCount(): Promise<number> {
    const log = await simpleGit(dir).log();
    return log.total;
  }

  async function remoteCommitCount(): Promise<number> {
    if (!remoteDir) throw new Error('no remote');
    const log = await simpleGit(remoteDir).log();
    return log.total;
  }

  async function initRepo(): Promise<void> {
    dir = await mkdtemp(join(tmpdir(), 'gitrac-cli-opts-'));
    const git = simpleGit(dir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    await git.addConfig('commit.gpgsign', 'false');
    await Bun.write(join(dir, 'README.md'), 'hello');
    await git.add('.');
    await git.commit('initial');
  }

  async function addRemote(): Promise<void> {
    remoteDir = await mkdtemp(join(tmpdir(), 'gitrac-cli-remote-'));
    await simpleGit(remoteDir).init(true);
    const git = simpleGit(dir);
    await git.addRemote('origin', remoteDir);
    await git.push(['-u', 'origin', 'HEAD']);
  }

  async function setAutoPush(value: boolean): Promise<void> {
    const config = await readConfig(dir);
    config.git.autoPush = value;
    await writeConfig(dir, config);
    const git = simpleGit(dir);
    await git.add('.issues/config.yaml');
    await git.commit('set autoPush');
    if (remoteDir) await git.push();
  }

  beforeEach(async () => {
    remoteDir = null;
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    await initRepo();
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
    if (remoteDir) await rm(remoteDir, { recursive: true, force: true });
  });

  describe('--no-commit (end-to-end)', () => {
    test('init --no-commit does not commit', async () => {
      const before = await commitCount();
      await run('init', '--no-commit');
      expect(await commitCount()).toBe(before);
      expect(await Bun.file(join(dir, '.issues/config.yaml')).exists()).toBe(
        true,
      );
    });

    test('init without --no-commit commits', async () => {
      const before = await commitCount();
      await run('init');
      expect(await commitCount()).toBe(before + 1);
    });

    describe('with an initialized tracker', () => {
      beforeEach(async () => {
        await run('init');
      });

      test('create --no-commit does not commit', async () => {
        const before = await commitCount();
        await run('create', '-t', 'First', '--no-commit');
        expect(await commitCount()).toBe(before);
        const status = await simpleGit(dir).status();
        expect(status.files.length).toBeGreaterThan(0);
      });

      test('create without --no-commit commits', async () => {
        const before = await commitCount();
        await run('create', '-t', 'First');
        expect(await commitCount()).toBe(before + 1);
      });

      test('global --no-commit before the subcommand is honored', async () => {
        const before = await commitCount();
        await run('--no-commit', 'create', '-t', 'First');
        expect(await commitCount()).toBe(before);
      });

      describe('on an existing issue', () => {
        beforeEach(async () => {
          await run('create', '-t', 'First');
        });

        const cases: [string, string[]][] = [
          ['edit', ['edit', '1', '-t', 'Renamed']],
          ['comment', ['comment', '1', 'hello']],
          ['close', ['close', '1']],
          ['claim', ['claim', '1']],
        ];

        for (const [name, args] of cases) {
          test(`${name} --no-commit does not commit`, async () => {
            const before = await commitCount();
            await run(...args, '--no-commit');
            expect(await commitCount()).toBe(before);
            const status = await simpleGit(dir).status();
            expect(status.files.length).toBeGreaterThan(0);
          });

          test(`${name} without --no-commit commits`, async () => {
            const before = await commitCount();
            await run(...args);
            expect(await commitCount()).toBe(before + 1);
          });
        }

        test('reopen --no-commit does not commit', async () => {
          await run('close', '1');
          const before = await commitCount();
          await run('reopen', '1', '--no-commit');
          expect(await commitCount()).toBe(before);
          const status = await simpleGit(dir).status();
          expect(status.files.length).toBeGreaterThan(0);
        });

        test('reopen without --no-commit commits', async () => {
          await run('close', '1');
          const before = await commitCount();
          await run('reopen', '1');
          expect(await commitCount()).toBe(before + 1);
        });
      });
    });
  });

  describe('--push / --no-push (end-to-end)', () => {
    beforeEach(async () => {
      await addRemote();
      await run('init');
    });

    test('autoPush false, no flag: does not push', async () => {
      await setAutoPush(false);
      const before = await remoteCommitCount();
      await run('create', '-t', 'First');
      expect(await remoteCommitCount()).toBe(before);
    });

    test('autoPush false, --push: pushes', async () => {
      await setAutoPush(false);
      const before = await remoteCommitCount();
      await run('create', '-t', 'First', '--push');
      expect(await remoteCommitCount()).toBe(before + 1);
    });

    test('autoPush true, no flag: pushes', async () => {
      await setAutoPush(true);
      const before = await remoteCommitCount();
      await run('create', '-t', 'First');
      expect(await remoteCommitCount()).toBe(before + 1);
    });

    test('autoPush true, --no-push: does not push', async () => {
      await setAutoPush(true);
      const before = await remoteCommitCount();
      await run('create', '-t', 'First', '--no-push');
      expect(await remoteCommitCount()).toBe(before);
      // Still committed locally
      const local = await simpleGit(dir).log();
      expect(local.latest?.message).toContain('create #1');
    });

    test('--push with --no-commit: neither commits nor pushes', async () => {
      await setAutoPush(false);
      const localBefore = await commitCount();
      const remoteBefore = await remoteCommitCount();
      await run('create', '-t', 'First', '--push', '--no-commit');
      expect(await commitCount()).toBe(localBefore);
      expect(await remoteCommitCount()).toBe(remoteBefore);
    });
  });
});
