import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { EXIT_INVALID_INPUT } from '../core/errors.ts';
import { readIssue } from '../fs/issue-store.ts';
import { resolveTextOption } from './text-input.ts';

/**
 * Regression tests for #43: `create`/`edit` accept `-d, --description` and
 * `--description-file <path|->`; `comment` accepts `--body-file <path|->`.
 */

// Each test spawns several CLI processes sequentially.
setDefaultTimeout(30_000);

const ENTRY = join(import.meta.dir, '..', '..', 'index.ts');

let root: string;

async function cli(
  args: string[],
  opts: { stdin?: string; cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(
    [process.execPath, ENTRY, '--author', 'Tester', ...args],
    {
      cwd: opts.cwd ?? root,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: opts.stdin !== undefined ? new Blob([opts.stdin]) : 'ignore',
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

async function head(): Promise<string> {
  return simpleGit(root).revparse(['HEAD']);
}

const MULTILINE = '# Goal\n\nDo the thing.\n\n- [ ] step one\n- [ ] step two';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitrac-text-input-')));
  const git = simpleGit(root);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await Bun.write(join(root, 'README.md'), 'hello');
  await git.add('.');
  await git.commit('initial');
  expect((await cli(['init'])).code).toBe(0);
  expect((await cli(['create', '-t', 'Existing'])).code).toBe(0);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('create description', () => {
  test('-d sets the description', async () => {
    const res = await cli(['create', '-t', 'New', '-d', 'Inline body']);
    expect(res.code).toBe(0);
    expect((await readIssue(root, 2)).description).toBe('Inline body');
    expect((await simpleGit(root).status()).isClean()).toBe(true);
  });

  test('--description sets the description', async () => {
    const res = await cli(['create', '-t', 'New', '--description', MULTILINE]);
    expect(res.code).toBe(0);
    expect((await readIssue(root, 2)).description).toBe(MULTILINE);
  });

  test('--description-file reads a file', async () => {
    await Bun.write(join(root, 'desc.md'), `${MULTILINE}\n`);
    const res = await cli([
      'create',
      '-t',
      'New',
      '--description-file',
      'desc.md',
    ]);
    expect(res.code).toBe(0);
    expect((await readIssue(root, 2)).description).toBe(MULTILINE);
  });

  test('--description-file paths are relative to the cwd', async () => {
    const sub = join(root, 'sub');
    await mkdir(sub);
    await Bun.write(join(sub, 'desc.md'), 'From subdir');
    const res = await cli(
      ['create', '-t', 'New', '--description-file', 'desc.md'],
      { cwd: sub },
    );
    expect(res.code).toBe(0);
    expect((await readIssue(root, 2)).description).toBe('From subdir');
  });

  test('--description-file - reads stdin', async () => {
    const res = await cli(['create', '-t', 'New', '--description-file', '-'], {
      stdin: `${MULTILINE}\n`,
    });
    expect(res.code).toBe(0);
    expect((await readIssue(root, 2)).description).toBe(MULTILINE);
  });

  test('description that looks like the comments separator round-trips', async () => {
    const tricky = 'Before\n\n---\n\n### someone — 2026-01-01T00:00:00Z\n\nx';
    const res = await cli(['create', '-t', 'New', '-d', tricky]);
    expect(res.code).toBe(0);
    const issue = await readIssue(root, 2);
    expect(issue.description).toBe(tricky);
    expect(issue.comments).toEqual([]);
  });

  test('rejects both -d and --description-file without writing', async () => {
    await Bun.write(join(root, 'desc.md'), 'file');
    const before = await head();
    const res = await cli([
      'create',
      '-t',
      'New',
      '-d',
      'inline',
      '--description-file',
      'desc.md',
    ]);
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stderr).toContain('not both');
    expect(await head()).toBe(before);
  });

  test('missing --description-file is invalid input; nothing written', async () => {
    const before = await head();
    const res = await cli([
      'create',
      '-t',
      'New',
      '--description-file',
      'nope.md',
    ]);
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stderr).toContain('file not found: nope.md');
    expect(res.stderr).not.toMatch(/^\s+at /m);
    expect(await head()).toBe(before);
  });
});

describe('edit description', () => {
  test('-d replaces the description and keeps comments', async () => {
    expect((await cli(['comment', '1', 'A comment'])).code).toBe(0);
    const res = await cli(['edit', '1', '-d', 'Updated body']);
    expect(res.code).toBe(0);
    const issue = await readIssue(root, 1);
    expect(issue.description).toBe('Updated body');
    expect(issue.comments.map((c) => c.body)).toEqual(['A comment']);
    expect((await simpleGit(root).status()).isClean()).toBe(true);
  });

  test('--description-file - reads stdin', async () => {
    const res = await cli(['edit', '1', '--description-file', '-'], {
      stdin: MULTILINE,
    });
    expect(res.code).toBe(0);
    expect((await readIssue(root, 1)).description).toBe(MULTILINE);
  });

  test('--description-file reads a file', async () => {
    await Bun.write(join(root, 'desc.md'), MULTILINE);
    const res = await cli(['edit', '1', '--description-file', 'desc.md']);
    expect(res.code).toBe(0);
    expect((await readIssue(root, 1)).description).toBe(MULTILINE);
  });

  test('-d "" clears the description', async () => {
    expect((await cli(['edit', '1', '-d', 'something'])).code).toBe(0);
    const res = await cli(['edit', '1', '-d', '']);
    expect(res.code).toBe(0);
    expect((await readIssue(root, 1)).description).toBe('');
  });

  test('edit without description flags leaves it alone', async () => {
    expect((await cli(['edit', '1', '-d', 'keep me'])).code).toBe(0);
    expect((await cli(['edit', '1', '-t', 'Renamed'])).code).toBe(0);
    const issue = await readIssue(root, 1);
    expect(issue.title).toBe('Renamed');
    expect(issue.description).toBe('keep me');
  });

  test('rejects both -d and --description-file without writing', async () => {
    const before = await head();
    const res = await cli(['edit', '1', '-d', 'x', '--description-file', '-']);
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stderr).toContain('not both');
    expect(await head()).toBe(before);
  });
});

describe('comment --body-file', () => {
  test('reads the body from a file', async () => {
    await Bun.write(join(root, 'c.md'), `${MULTILINE}\n`);
    const res = await cli(['comment', '1', '--body-file', 'c.md']);
    expect(res.code).toBe(0);
    const issue = await readIssue(root, 1);
    expect(issue.comments.map((c) => c.body)).toEqual([MULTILINE]);
  });

  test('--body-file - reads stdin', async () => {
    const res = await cli(['comment', '1', '--body-file', '-'], {
      stdin: 'from stdin\n',
    });
    expect(res.code).toBe(0);
    const issue = await readIssue(root, 1);
    expect(issue.comments.map((c) => c.body)).toEqual(['from stdin']);
  });

  test('-F is a short alias', async () => {
    await Bun.write(join(root, 'c.md'), 'short flag');
    const res = await cli(['comment', '1', '-F', 'c.md']);
    expect(res.code).toBe(0);
    expect((await readIssue(root, 1)).comments[0]?.body).toBe('short flag');
  });

  test('implicit piped stdin still works', async () => {
    const res = await cli(['comment', '1'], { stdin: 'piped' });
    expect(res.code).toBe(0);
    expect((await readIssue(root, 1)).comments[0]?.body).toBe('piped');
  });

  test('rejects a body argument together with --body-file', async () => {
    await Bun.write(join(root, 'c.md'), 'file');
    const before = await head();
    const res = await cli(['comment', '1', 'inline', '--body-file', 'c.md']);
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stderr).toContain('not both');
    expect(await head()).toBe(before);
  });

  test('empty --body-file is rejected', async () => {
    await Bun.write(join(root, 'c.md'), '  \n');
    const before = await head();
    const res = await cli(['comment', '1', '--body-file', 'c.md']);
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stderr).toContain('Comment body is required');
    expect(await head()).toBe(before);
  });
});

describe('resolveTextOption', () => {
  const flags = { inlineFlag: '--a', fileFlag: '--a-file' };

  test('returns undefined when neither is given', async () => {
    expect(
      await resolveTextOption({ inline: undefined, file: undefined, ...flags }),
    ).toBeUndefined();
  });

  test('trims inline text', async () => {
    expect(
      await resolveTextOption({ inline: '  hi\n', file: undefined, ...flags }),
    ).toBe('hi');
  });

  test('throws when both are given', async () => {
    await expect(
      resolveTextOption({ inline: 'x', file: 'y', ...flags }),
    ).rejects.toThrow('Use either --a or --a-file, not both.');
  });
});
