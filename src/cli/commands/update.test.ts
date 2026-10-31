import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitracError } from '../../core/errors.ts';
import {
  formatUpdateResult,
  runUpdate,
  type UpdateEnvironment,
} from './update.ts';

/** Regression tests for #125: `gitrac update` / `gitrac upgrade`. */

const LATEST_URL = 'https://github.com/murrayju/gitrac/releases/latest';
const NPM_URL = 'https://registry.npmjs.org/@gitrac/cli/latest';
const ASSET_URL =
  'https://github.com/murrayju/gitrac/releases/download/v0.3.0/gitrac-linux-x64';
const NPM_BINARY =
  '/opt/node/lib/node_modules/@gitrac/cli/node_modules/@gitrac/cli-linux-x64/bin/gitrac';

let dir: string;
let binaryPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-update-'));
  binaryPath = join(dir, 'gitrac');
  await writeFile(binaryPath, 'old binary', { mode: 0o755 });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface FakeCalls {
  fetched: string[];
  ran: { command: string[]; stdout: 'stdout' | 'stderr' }[];
}

/** An environment with gitrac 0.2.1 and release 0.3.0 on GitHub and npm. */
function fakeEnvironment(
  overrides: Partial<UpdateEnvironment> = {},
): UpdateEnvironment & { calls: FakeCalls } {
  const calls: FakeCalls = { fetched: [], ran: [] };
  return {
    calls,
    currentVersion: '0.2.1',
    execPath: binaryPath,
    compiled: true,
    platform: 'linux',
    arch: 'x64',
    fetch: async (url) => {
      calls.fetched.push(url);
      if (url === LATEST_URL) {
        return new Response(null, {
          status: 302,
          headers: {
            location: 'https://github.com/murrayju/gitrac/releases/tag/v0.3.0',
          },
        });
      }
      if (url === NPM_URL) return Response.json({ version: '0.3.0' });
      if (url === ASSET_URL) return new Response('new binary');
      return new Response('not found', { status: 404 });
    },
    which: (command) => `/usr/bin/${command}`,
    run: async (command, stdout) => {
      calls.ran.push({ command, stdout });
      return 0;
    },
    binaryVersion: async () => '0.3.0',
    log: () => {},
    ...overrides,
  };
}

async function updateError(promise: Promise<unknown>): Promise<GitracError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(GitracError);
  return err as GitracError;
}

const human = { check: false, format: 'human' } as const;

describe('standalone binary', () => {
  test('replaces the binary with the latest release', async () => {
    const env = fakeEnvironment();
    const result = await runUpdate(env, human);
    expect(result).toEqual({
      method: 'binary',
      current: '0.2.1',
      latest: '0.3.0',
      updated: true,
      path: binaryPath,
    });
    expect(await readFile(binaryPath, 'utf8')).toBe('new binary');
    expect((await stat(binaryPath)).mode & 0o111).toBe(0o111);
    // No temporary file is left behind.
    expect(await readdir(dir)).toEqual(['gitrac']);
    expect(formatUpdateResult(result, human)).toBe(
      `Updated gitrac 0.2.1 → 0.3.0 (${binaryPath})`,
    );
  });

  test('up to date: downloads nothing', async () => {
    const env = fakeEnvironment({ currentVersion: '0.3.0' });
    const result = await runUpdate(env, human);
    expect(result.updated).toBe(false);
    expect(env.calls.fetched).toEqual([LATEST_URL]);
    expect(await readFile(binaryPath, 'utf8')).toBe('old binary');
    expect(formatUpdateResult(result, human)).toBe(
      `gitrac 0.3.0 is up to date (${binaryPath})`,
    );
  });

  test('a newer local build is not downgraded', async () => {
    const env = fakeEnvironment({ currentVersion: '0.4.0-rc.1' });
    expect((await runUpdate(env, human)).updated).toBe(false);
    expect(await readFile(binaryPath, 'utf8')).toBe('old binary');
  });

  test('--check reports the new version and changes nothing', async () => {
    const env = fakeEnvironment();
    const options = { check: true, format: 'human' } as const;
    const result = await runUpdate(env, options);
    expect(result.updated).toBe(false);
    expect(result.latest).toBe('0.3.0');
    expect(env.calls.fetched).toEqual([LATEST_URL]);
    expect(await readFile(binaryPath, 'utf8')).toBe('old binary');
    expect(formatUpdateResult(result, options)).toContain(
      'gitrac 0.3.0 is available (installed: 0.2.1',
    );
  });

  test('a download that reports the wrong version is not installed', async () => {
    const env = fakeEnvironment({ binaryVersion: async () => '' });
    const err = await updateError(runUpdate(env, human));
    expect(err.message).toContain('expected 0.3.0');
    expect(await readFile(binaryPath, 'utf8')).toBe('old binary');
    expect(await readdir(dir)).toEqual(['gitrac']);
  });

  test('a failed download leaves the binary as it was', async () => {
    const env = fakeEnvironment({
      fetch: async (url) =>
        url === LATEST_URL
          ? new Response(null, {
              status: 302,
              headers: {
                location:
                  'https://github.com/murrayju/gitrac/releases/tag/v0.3.0',
              },
            })
          : new Response('nope', { status: 404 }),
    });
    const err = await updateError(runUpdate(env, human));
    expect(err.message).toContain('HTTP 404');
    expect(await readFile(binaryPath, 'utf8')).toBe('old binary');
  });

  test('no release for the platform', async () => {
    const env = fakeEnvironment({ platform: 'darwin', arch: 'x64' });
    const err = await updateError(runUpdate(env, human));
    expect(err.message).toContain('darwin-x64');
  });

  test('an unreadable latest release is an error', async () => {
    const env = fakeEnvironment({
      fetch: async () => new Response('', { status: 200 }),
    });
    const err = await updateError(runUpdate(env, human));
    expect(err.message).toContain('Could not read the latest gitrac version');
  });
});

describe('package manager', () => {
  test('npm: reinstalls into the same prefix', async () => {
    const env = fakeEnvironment({ execPath: NPM_BINARY });
    const result = await runUpdate(env, human);
    expect(result).toEqual({
      method: 'npm',
      current: '0.2.1',
      latest: '0.3.0',
      updated: true,
      command: 'npm install --global --prefix /opt/node @gitrac/cli@latest',
    });
    expect(env.calls.fetched).toEqual([NPM_URL]);
    expect(env.calls.ran).toEqual([
      {
        command: [
          'npm',
          'install',
          '--global',
          '--prefix',
          '/opt/node',
          '@gitrac/cli@latest',
        ],
        stdout: 'stdout',
      },
    ]);
  });

  test('json output: the package manager writes to stderr', async () => {
    const env = fakeEnvironment({
      execPath:
        '/home/u/.bun/install/global/node_modules/@gitrac/cli-linux-x64/bin/gitrac',
    });
    const options = { check: false, format: 'json' } as const;
    const result = await runUpdate(env, options);
    expect(env.calls.ran).toEqual([
      {
        command: ['bun', 'add', '--global', '@gitrac/cli@latest'],
        stdout: 'stderr',
      },
    ]);
    expect(JSON.parse(formatUpdateResult(result, options))).toEqual({
      method: 'bun',
      current: '0.2.1',
      latest: '0.3.0',
      updated: true,
      command: 'bun add --global @gitrac/cli@latest',
    });
  });

  test('up to date or --check: runs nothing', async () => {
    const upToDate = fakeEnvironment({
      execPath: NPM_BINARY,
      currentVersion: '0.3.0',
    });
    expect((await runUpdate(upToDate, human)).updated).toBe(false);
    expect(upToDate.calls.ran).toEqual([]);

    const check = fakeEnvironment({ execPath: NPM_BINARY });
    const result = await runUpdate(check, { check: true, format: 'human' });
    expect(result.updated).toBe(false);
    expect(check.calls.ran).toEqual([]);
  });

  test('a failing package manager is an error', async () => {
    const env = fakeEnvironment({ execPath: NPM_BINARY, run: async () => 1 });
    const err = await updateError(runUpdate(env, human));
    expect(err.message).toContain('failed (exit code 1)');
  });

  test('a package manager that is not on PATH is an error', async () => {
    const env = fakeEnvironment({ execPath: NPM_BINARY, which: () => null });
    const err = await updateError(runUpdate(env, human));
    expect(err.message).toContain('npm is not on PATH');
    expect(env.calls.ran).toEqual([]);
  });
});

describe('nothing to update', () => {
  test.each([
    ['source', { compiled: false }, 'source checkout'],
    [
      'npx',
      {
        execPath:
          '/home/u/.npm/_npx/49a1/node_modules/@gitrac/cli-linux-x64/bin/gitrac',
      },
      'npx',
    ],
    [
      'dependency',
      {
        execPath:
          '/home/u/project/node_modules/@gitrac/cli-linux-x64/bin/gitrac',
      },
      'project dependency',
    ],
  ] as const)('%s: exit 3, nothing fetched', async (_name, overrides, text) => {
    const env = fakeEnvironment(overrides);
    const err = await updateError(runUpdate(env, human));
    expect(err.code).toBe('invalid_state');
    expect(err.exitCode).toBe(3);
    expect(err.message).toContain(text);
    expect(env.calls.fetched).toEqual([]);
  });
});
