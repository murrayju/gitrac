import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { ISSUES_GITIGNORE_PATH, writeIssuesGitignore } from './gitignore.ts';

let dir: string;
const file = () => join(dir, ISSUES_GITIGNORE_PATH);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-gitignore-'));
  await mkdir(join(dir, '.issues'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('writeIssuesGitignore', () => {
  test('creates .issues/.gitignore ignoring drafts, once', async () => {
    expect(await writeIssuesGitignore(dir)).toBe(true);
    const content = await readFile(file(), 'utf-8');
    expect(content.split('\n')).toContain('drafts/');
    expect(content.endsWith('\n')).toBe(true);

    expect(await writeIssuesGitignore(dir)).toBe(false);
    expect(await readFile(file(), 'utf-8')).toBe(content);
  });

  test('appends to an existing file, keeping its lines', async () => {
    await writeFile(file(), '*.bak');
    expect(await writeIssuesGitignore(dir)).toBe(true);
    expect(await readFile(file(), 'utf-8')).toBe('*.bak\ndrafts/\n');
  });

  test('accepts an equivalent existing pattern', async () => {
    for (const pattern of ['drafts', '/drafts/', '  /drafts  ']) {
      await writeFile(file(), `${pattern}\n`);
      expect(await writeIssuesGitignore(dir)).toBe(false);
    }
  });

  test('makes git ignore drafts', async () => {
    const git = simpleGit(dir);
    await git.init();
    await writeIssuesGitignore(dir);
    await mkdir(join(dir, '.issues', 'drafts'));
    await writeFile(join(dir, '.issues', 'drafts', 'd.json'), '{}');
    const ignored = await git.checkIgnore([
      join('.issues', 'drafts', 'd.json'),
    ]);
    expect(ignored).toEqual([join('.issues', 'drafts', 'd.json')]);
    const status = await git.status();
    expect(status.not_added).toEqual([ISSUES_GITIGNORE_PATH]);
  });
});
