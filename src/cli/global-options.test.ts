import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import simpleGit from 'simple-git';
import { EXIT_INVALID_INPUT, GitracError } from '../core/errors.ts';
import { readConfig, readIssue, writeConfig } from '../fs/issue-store.ts';
import { resolveServeOptions } from './commands/serve.ts';
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

  test('-p is not a global option (bare `gitrac -p` is rejected)', () => {
    const program = createProgram();
    program.action(() => {});
    program.exitOverride();
    program.configureOutput({ writeErr: () => {} });
    expect(() => program.parse(['node', 'gitrac', '-p', '4000'])).toThrow(
      /unknown option '-p'/,
    );
  });
});

describe('short-flag collisions', () => {
  test('no subcommand short flag is shadowed by a program-level flag', () => {
    const program = createProgram();
    const globalShorts = new Set(
      program.options.map((o) => o.short).filter(Boolean),
    );
    const collisions: string[] = [];
    for (const cmd of program.commands) {
      for (const opt of cmd.options) {
        if (opt.short && globalShorts.has(opt.short)) {
          collisions.push(`${cmd.name()} ${opt.short}`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });
});

describe('create/edit -p (real Commander parsing)', () => {
  function subOpts(args: string[], name: string): Record<string, unknown> {
    const program = parseOnly(args);
    const cmd = program.commands.find((c) => c.name() === name);
    if (!cmd) throw new Error(`no ${name} command`);
    return cmd.opts();
  }

  test('create -p high sets priority', () => {
    expect(subOpts(['create', '-t', 'x', '-p', 'high'], 'create')).toEqual(
      expect.objectContaining({ title: 'x', priority: 'high' }),
    );
  });

  test('create -p high with global flags before the subcommand', () => {
    expect(
      subOpts(['-o', 'json', 'create', '-p', 'high', '-t', 'x'], 'create')
        .priority,
    ).toBe('high');
  });

  test('edit -p high sets priority', () => {
    expect(subOpts(['edit', '1', '-p', 'high'], 'edit').priority).toBe('high');
  });
});

describe('serve / bare gitrac port resolution', () => {
  function resolve(args: string[]) {
    const program = parseOnly(args);
    const serve = program.commands.find((c) => c.name() === 'serve');
    const usedServe = args.includes('serve');
    return resolveServeOptions(program, usedServe ? serve : undefined);
  }

  test('bare gitrac defaults to port 3000', () => {
    expect(resolve([]).port).toBe(3000);
  });

  test('bare gitrac --port 4000', () => {
    expect(resolve(['--port', '4000']).port).toBe(4000);
  });

  test('serve defaults to port 3000', () => {
    expect(resolve(['serve']).port).toBe(3000);
  });

  test('serve -p 4000', () => {
    expect(resolve(['serve', '-p', '4000']).port).toBe(4000);
  });

  test('serve --port 4000', () => {
    expect(resolve(['serve', '--port', '4000']).port).toBe(4000);
  });

  test('serve -p wins over a global --port', () => {
    expect(resolve(['--port', '1234', 'serve', '-p', '4000']).port).toBe(4000);
  });

  test('serve honors --dir', () => {
    expect(resolve(['--dir', '/tmp/x', 'serve']).dir).toBe('/tmp/x');
  });

  test('binds to loopback (127.0.0.1) by default', () => {
    expect(resolve([]).host).toBe('127.0.0.1');
    expect(resolve(['serve']).host).toBe('127.0.0.1');
  });

  test('bare gitrac --host 0.0.0.0', () => {
    expect(resolve(['--host', '0.0.0.0']).host).toBe('0.0.0.0');
  });

  test('serve --host 0.0.0.0', () => {
    expect(resolve(['serve', '--host', '0.0.0.0']).host).toBe('0.0.0.0');
  });

  test('--author sets the default web author', () => {
    expect(resolve(['--author', 'Bot', 'serve']).author).toBe('Bot');
    expect(resolve([]).author).toBe('');
  });

  test('accepts the full port range 0-65535', () => {
    expect(resolve(['serve', '-p', '0']).port).toBe(0);
    expect(resolve(['serve', '-p', '65535']).port).toBe(65535);
    expect(resolve(['--port', '65535']).port).toBe(65535);
  });

  // #85: invalid ports echo the original input as an invalid_input error.
  const badPorts = [
    'abc',
    '99999',
    '65536',
    '-1',
    '4000abc',
    '40.5',
    '0x10',
    '',
    ' 80',
  ];
  for (const bad of badPorts) {
    for (const args of [
      ['serve', `--port=${bad}`],
      ['serve', `-p${bad}`],
      [`--port=${bad}`],
    ]) {
      if (args[1] === '-p' && bad === '') continue;
      test(`rejects ${JSON.stringify(args)}`, () => {
        let error: unknown;
        try {
          resolve(args);
        } catch (err) {
          error = err;
        }
        expect(error).toBeInstanceOf(GitracError);
        const e = error as GitracError;
        expect(e.code).toBe('invalid_input');
        expect(e.exitCode).toBe(EXIT_INVALID_INPUT);
        expect(e.message).toBe(
          `Invalid port "${bad}": must be an integer from 0 to 65535.`,
        );
        expect(e.message).not.toContain('NaN');
      });
    }
  }
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

      test('create -p high persists priority', async () => {
        await run('create', '-t', 'First', '-p', 'high', '--no-commit');
        const config = await readConfig(dir);
        expect(config.defaultPriority).not.toBe('high');
        const issue = await readIssue(dir, 1);
        expect(issue.priority).toBe('high');
      });

      test('edit -p high persists priority', async () => {
        await run('create', '-t', 'First', '-p', 'low', '--no-commit');
        await run('edit', '1', '-p', 'high', '--no-commit');
        const issue = await readIssue(dir, 1);
        expect(issue.priority).toBe('high');
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
