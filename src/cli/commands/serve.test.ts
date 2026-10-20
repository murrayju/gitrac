import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { EXIT_GENERAL, EXIT_INVALID_INPUT } from '../../core/errors.ts';
import { parsePort } from './serve.ts';

const ENTRY = join(import.meta.dir, '..', '..', '..', 'index.ts');

describe('parsePort', () => {
  test('accepts plain integers in 0-65535', () => {
    expect(parsePort('0')).toBe(0);
    expect(parsePort('3000')).toBe(3000);
    expect(parsePort('065535')).toBe(65535);
  });

  for (const bad of ['abc', '99999', '65536', '-1', '1e3', '4000abc', '']) {
    test(`rejects ${JSON.stringify(bad)} echoing the input`, () => {
      expect(() => parsePort(bad)).toThrow(
        `Invalid port "${bad}": must be an integer from 0 to 65535.`,
      );
    });
  }
});

// #85: end-to-end, an invalid port is a standard invalid_input error (exit 2)
// that names the original value, and is reported before anything else (here:
// the cwd isn't even a git repo).
describe('gitrac serve with an invalid port or author (end-to-end)', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gitrac-serve-port-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function cli(...args: string[]) {
    const proc = Bun.spawn([process.execPath, ENTRY, ...args], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  }

  const cases: [string, string[]][] = [
    ['abc', ['serve', '--port', 'abc']],
    ['99999', ['serve', '-p', '99999']],
    ['abc', ['--port', 'abc']],
  ];
  for (const [value, args] of cases) {
    test(`gitrac ${args.join(' ')}`, async () => {
      const { code, stdout, stderr } = await cli(...args);
      expect(code).toBe(EXIT_INVALID_INPUT);
      expect(stdout).toBe('');
      expect(stderr.trim()).toBe(
        `Error: Invalid port "${value}": must be an integer from 0 to 65535.`,
      );
    });
  }

  // #109: a bad --author fails at startup, not on every write. The check
  // runs before the project root is resolved (the cwd is not a git repo).
  const authorCases: [string, string[]][] = [
    [
      'must not contain the em dash (U+2014)',
      ['--author', 'A \u2014 B', 'serve'],
    ],
    ['must not contain the em dash (U+2014)', ['--author', 'A \u2014 B']],
    ['must not contain line breaks', ['--author', 'A\nB', 'serve']],
  ];
  for (const [problem, args] of authorCases) {
    test(`gitrac ${JSON.stringify(args.join(' '))} fails at startup`, async () => {
      const { code, stdout, stderr } = await cli(...args);
      expect(code).toBe(EXIT_INVALID_INPUT);
      expect(stdout).toBe('');
      expect(stderr.trim()).toBe(
        `Error: Invalid author ${JSON.stringify(args[1])}: ${problem}`,
      );
    });
  }

  test('-o json reports code invalid_input', async () => {
    const { code, stderr } = await cli('-o', 'json', 'serve', '-p', 'abc');
    expect(code).toBe(EXIT_INVALID_INPUT);
    expect(JSON.parse(stderr.trim())).toEqual({
      error: {
        code: 'invalid_input',
        message: 'Invalid port "abc": must be an integer from 0 to 65535.',
      },
    });
  });
});

// #118: an explicit port is used as is. If it is busy, serve fails with a
// server_error that names the port, and does not move to another port.
describe('gitrac serve port selection (end-to-end)', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'gitrac-serve-busy-')));
    const git = simpleGit(dir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    await git.addConfig('commit.gpgsign', 'false');
    const init = Bun.spawn([process.execPath, ENTRY, 'init'], {
      cwd: dir,
      stdout: 'ignore',
      stderr: 'ignore',
    });
    expect(await init.exited).toBe(0);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function serve(...args: string[]) {
    // stdout is a pipe (not a TTY), so no browser opens.
    return Bun.spawn([process.execPath, ENTRY, ...args], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    });
  }

  for (const flag of ['-p', '--port']) {
    test(`serve ${flag} <busy port> fails with server_error`, async () => {
      const handler = () => new Response('busy');
      const blocker = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: handler,
      });
      const busy = blocker.port as number;
      try {
        const args =
          flag === '-p' ? ['serve', '-p', String(busy)] : ['--port', `${busy}`];
        const proc = serve('-o', 'json', ...args);
        const timer = setTimeout(() => proc.kill(), 10_000);
        const [stderr, code] = await Promise.all([
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        clearTimeout(timer);
        expect(code).toBe(EXIT_GENERAL);
        const { error } = JSON.parse(stderr.trim().split('\n').at(-1) ?? '');
        expect(error.code).toBe('server_error');
        expect(error.message).toContain(`127.0.0.1:${busy}`);
        expect(error.message).toContain(`port ${busy} is already in use`);
      } finally {
        blocker.stop(true);
      }
    });
  }

  test('serve -p 0 binds a free port and prints it', async () => {
    const proc = serve('serve', '-p', '0');
    try {
      const reader = proc.stdout.getReader();
      let out = '';
      const deadline = Date.now() + 10_000;
      while (!/localhost:\d+/.test(out) && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        out += new TextDecoder().decode(value);
      }
      const port = Number(out.match(/localhost:(\d+)/)?.[1]);
      expect(port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${port}/api/issues`);
      expect(res.status).toBe(200);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
});
