import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { EXIT_INVALID_INPUT } from '../core/errors.ts';
import { readConfig, readIssue } from '../fs/issue-store.ts';

/**
 * Regression tests for #41: `create` and `edit` must validate status,
 * priority, title and labels before writing; invalid input exits 2 (EXIT_INVALID_INPUT) with a
 * clear error and leaves the files (and git history) untouched. Unknown labels
 * are registered in config.yaml with a color, like the web UI.
 */

const ENTRY = join(import.meta.dir, '..', '..', 'index.ts');

let root: string;

async function cli(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(
    [process.execPath, ENTRY, '--author', 'Tester', ...args],
    { cwd: root, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** Snapshot every file under .issues/ plus HEAD, to assert nothing changed. */
async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const entries = await readdir(join(root, '.issues'), {
    recursive: true,
    withFileTypes: true,
  });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const p = join(e.parentPath, e.name);
    out[p] = await readFile(p, 'utf-8');
  }
  out.HEAD = await simpleGit(root).revparse(['HEAD']);
  return out;
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitrac-validate-')));
  const git = simpleGit(root);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await Bun.write(join(root, 'README.md'), 'hello');
  await git.add('.');
  await git.commit('initial');
  expect((await cli('init')).code).toBe(0);
  expect((await cli('create', '-t', 'Existing')).code).toBe(0);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('create validation', () => {
  test.each([
    ['unknown status', ['-s', 'bogus'], /Invalid status "bogus"/],
    ['unknown priority', ['-p', 'critical'], /Invalid priority "critical"/],
    ['blank title', ['-t', '   '], /Invalid title/],
  ])('rejects %s', async (_name, args, pattern) => {
    const before = await snapshot();
    const res = await cli('create', '-t', 'New one', ...args);
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stderr).toMatch(pattern);
    expect(res.stderr).not.toMatch(/^\s+at /m);
    // No issue file, no ID allocated, no commit
    expect(await snapshot()).toEqual(before);
  });

  test('reports every invalid field at once', async () => {
    const res = await cli('create', '-t', 'x', '-s', 'nope', '-p', 'nah');
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stderr).toContain('Invalid status');
    expect(res.stderr).toContain('Invalid priority');
  });

  test('unknown labels are registered in config with a color', async () => {
    const res = await cli('create', '-t', 'Labeled', '-l', 'bug, shiny-new,');
    expect(res.code).toBe(0);
    const issue = await readIssue(root, 2);
    expect(issue.labels).toEqual(['bug', 'shiny-new']);
    const config = await readConfig(root);
    expect(config.labels['shiny-new']).toMatch(/^#[0-9a-f]{6}$/);
    // config change is part of the create commit (working tree clean)
    const status = await simpleGit(root).status();
    expect(status.isClean()).toBe(true);
  });
});

describe('edit validation', () => {
  test.each([
    ['unknown status', ['-s', 'bogus'], /Invalid status "bogus"/],
    ['unknown priority', ['-p', 'critical'], /Invalid priority "critical"/],
    ['blank title', ['-t', ''], /Invalid title/],
  ])('rejects %s', async (_name, args, pattern) => {
    const before = await snapshot();
    const res = await cli('edit', '1', ...args);
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stderr).toMatch(pattern);
    expect(await snapshot()).toEqual(before);
  });

  test('a single invalid field rejects the whole edit', async () => {
    const before = await snapshot();
    const res = await cli('edit', '1', '-t', 'Renamed', '-s', 'bogus');
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(await snapshot()).toEqual(before);
    expect((await readIssue(root, 1)).title).toBe('Existing');
  });

  test('unknown labels are registered in config with a color', async () => {
    const res = await cli('edit', '1', '-l', 'fresh');
    expect(res.code).toBe(0);
    expect((await readIssue(root, 1)).labels).toEqual(['fresh']);
    expect((await readConfig(root)).labels.fresh).toMatch(/^#[0-9a-f]{6}$/);
    expect((await simpleGit(root).status()).isClean()).toBe(true);
  });

  test('-l "" clears labels', async () => {
    expect((await cli('edit', '1', '-l', 'bug')).code).toBe(0);
    const res = await cli('edit', '1', '-l', '');
    expect(res.code).toBe(0);
    expect((await readIssue(root, 1)).labels).toEqual([]);
  });
});

/** #98: line breaks and comment-header delimiters are invalid_input. */
describe('line break and author validation', () => {
  test.each([
    [
      'a title',
      ['create', '-t', 'Two\nlines'],
      /Invalid title: must not contain line breaks/,
    ],
    ['an assignee', ['create', '-t', 'New', '-a', 'a\nb'], /Invalid assignee/],
    [
      'a label',
      ['create', '-t', 'New', '-l', 'ok,bad\rlabel'],
      /Invalid labels/,
    ],
    ['an edited title', ['edit', '1', '-t', 'New\ntitle'], /Invalid title/],
    ['an edited label', ['edit', '1', '-l', 'x\ny'], /Invalid labels/],
  ])('rejects a line break in %s', async (_name, args, pattern) => {
    const before = await snapshot();
    const res = await cli(...args);
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(res.stderr).toMatch(pattern);
    expect(await snapshot()).toEqual(before);
  });

  test.each([
    ['a line break', 'Bad\nAuthor'],
    ['an em dash', 'Bad \u2014 2026-01-01T00:00:00Z'],
  ])('rejects an --author with %s for every write that uses it', async (_name, author) => {
    const before = await snapshot();
    for (const args of [
      ['create', '-t', 'New'],
      ['comment', '1', 'hello'],
      ['close', '1', '--comment', 'bye'],
      ['claim', '1', '--comment', 'mine'],
    ]) {
      const res = await cli('--author', author, ...args);
      expect(res.code).toBe(EXIT_INVALID_INPUT);
      expect(res.stderr).toContain('Invalid author');
      expect(res.stderr).not.toMatch(/^\s+at /m);
    }
    expect(await snapshot()).toEqual(before);
  });

  test('-o json reports invalid_input', async () => {
    const res = await cli(
      '-o',
      'json',
      '--author',
      'A\nB',
      'comment',
      '1',
      'x',
    );
    expect(res.code).toBe(EXIT_INVALID_INPUT);
    expect(JSON.parse(res.stderr).error.code).toBe('invalid_input');
  });
});
