import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT_INVALID_INPUT } from '../../core/errors.ts';
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
