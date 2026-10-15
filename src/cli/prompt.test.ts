import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  spyOn,
  test,
} from 'bun:test';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import simpleGit from 'simple-git';
import { EXIT_INVALID_INPUT, GitracError } from '../core/errors.ts';
import { askTitle } from './commands/create.ts';
import { promptLine } from './prompt.ts';

/**
 * Regression tests for #82: interactive prompts go to stderr, and commands
 * only prompt when stdin is a terminal.
 */

// The CLI tests spawn several processes sequentially.
setDefaultTimeout(30_000);

/** A fake terminal: `answer` is typed after the question (null: Ctrl-D). */
function streams(answer: string | null) {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = '';
  output.on('data', (chunk) => {
    written += String(chunk);
  });
  if (answer === null) input.end();
  else input.end(`${answer}\n`);
  return { input, output, written: () => written };
}

describe('promptLine', () => {
  test('writes the question to the output stream and reads a line', async () => {
    const s = streams('hello world');
    expect(await promptLine('Name?', s)).toBe('hello world');
    expect(s.written()).toBe('Name? ');
  });

  test('resolves null on EOF', async () => {
    const s = streams(null);
    expect(await promptLine('Name?', s)).toBeNull();
  });

  test('defaults to stderr, not stdout', async () => {
    const out = spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { input } = streams('yes');
      expect(await promptLine('Sure?', { input })).toBe('yes');
      expect(err).toHaveBeenCalledWith('Sure? ');
      expect(out).not.toHaveBeenCalled();
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });
});

describe('askTitle', () => {
  test('asks on a terminal', async () => {
    const s = streams('  My title  ');
    expect(await askTitle(() => true, s)).toBe('My title');
    expect(s.written()).toBe('Issue title: ');
  });

  test('an empty answer or EOF is invalid_input', async () => {
    for (const answer of ['', '   ', null]) {
      const err = await askTitle(() => true, streams(answer)).catch((e) => e);
      expect(err).toBeInstanceOf(GitracError);
      expect((err as GitracError).code).toBe('invalid_input');
    }
  });

  test('does not ask when stdin is not a terminal', async () => {
    const s = streams('My title');
    const err = await askTitle(() => false, s).catch((e) => e);
    expect((err as GitracError).code).toBe('invalid_input');
    expect((err as GitracError).message).toContain('--title');
    expect(s.written()).toBe('');
  });
});

test("CLI code never uses Bun's global prompt() (it writes to stdout)", async () => {
  const dir = import.meta.dir;
  const files = (await readdir(dir, { recursive: true })).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );
  for (const f of files) {
    const source = await readFile(join(dir, f), 'utf8');
    expect({ file: f, global: /(?<![.\w])prompt\(/.test(source) }).toEqual({
      file: f,
      global: false,
    });
  }
});

describe('gitrac create without a title (stdin not a terminal)', () => {
  const ENTRY = join(import.meta.dir, '..', '..', 'index.ts');
  let root: string;

  async function cli(
    args: string[],
    stdin?: string,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(
      [process.execPath, ENTRY, '--author', 'Tester', ...args],
      {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: stdin !== undefined ? new Blob([stdin]) : 'ignore',
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  }

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'gitrac-prompt-')));
    const git = simpleGit(root);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    await git.addConfig('commit.gpgsign', 'false');
    await Bun.write(join(root, 'README.md'), 'hello');
    await git.add('.');
    await git.commit('initial');
    expect((await cli(['init'])).code).toBe(0);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function issueFiles(): Promise<string[]> {
    return (await readdir(join(root, '.issues'))).filter((f) =>
      f.endsWith('.md'),
    );
  }

  test('fails with invalid_input instead of reading a piped title', async () => {
    const res = await cli(['create'], 'Piped title\n');
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stdout).toBe('');
    expect(res.stderr).not.toContain('Issue title:');
    expect(res.stderr).toContain('Title is required');
    expect(await issueFiles()).toEqual([]);
  });

  test('-o json keeps stdout empty and reports the error on stderr', async () => {
    const res = await cli(['-o', 'json', 'create']);
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stdout).toBe('');
    expect(JSON.parse(res.stderr.trim())).toMatchObject({
      error: { code: 'invalid_input' },
    });
  });

  test('-t still works without a terminal', async () => {
    const res = await cli(['create', '-t', 'Given']);
    expect(res.code).toBe(0);
    expect(await issueFiles()).toHaveLength(1);
  });
});
