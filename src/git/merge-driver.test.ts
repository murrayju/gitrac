import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import simpleGit from 'simple-git';
import { createDefaultConfig, serializeConfig } from '../core/config.ts';
import { parseIssue, serializeIssue } from '../core/issue.ts';
import type { Issue } from '../core/types.ts';
import {
  configureMergeDriver,
  GITATTRIBUTES_PATH,
  gitMergeText,
  mergeDriverConfigValue,
  mergeKindForPath,
  runMergeDriver,
  shellQuote,
  writeMergeAttributes,
} from './merge-driver.ts';

const INDEX_TS = resolve(import.meta.dir, '..', '..', 'index.ts');

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 1,
    title: 'Login times out',
    status: 'todo',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2025-01-01T00:00:00Z',
    createdBy: 'tester',
    updated: '2025-01-01T00:00:00Z',
    description: 'one\ntwo\nthree\nfour\nfive',
    comments: [],
    ...overrides,
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-merge-driver-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('mergeKindForPath', () => {
  test('routes gitrac files', () => {
    expect(mergeKindForPath('.issues/config.yaml')).toBe('config');
    expect(mergeKindForPath('.issues/3-x.md')).toBe('issue');
    expect(mergeKindForPath('.issues/closed/3-x.md')).toBe('issue');
    expect(mergeKindForPath('.issues/assets/a.png')).toBe('text');
    expect(mergeKindForPath('docs/readme.md')).toBe('text');
    expect(mergeKindForPath('.issues/closed/config.yaml')).toBe('text');
  });

  test('guesses from content without a path', () => {
    expect(mergeKindForPath(undefined, '---\nid: 1\n---\n')).toBe('issue');
    expect(mergeKindForPath(undefined, 'version: 1\n')).toBe('config');
  });
});

describe('gitMergeText', () => {
  test('merges non-overlapping edits', async () => {
    const result = await gitMergeText(
      'a\nb\nc\nd\n',
      'A\nb\nc\nd\n',
      'a\nb\nc\nD\n',
    );
    expect(result).toEqual({ text: 'A\nb\nc\nD\n', conflict: false });
  });

  test('leaves conflict markers', async () => {
    const result = await gitMergeText('a\n', 'ours\n', 'theirs\n', 9);
    expect(result.conflict).toBe(true);
    expect(result.text).toBe(
      '<<<<<<<<< ours\nours\n=========\ntheirs\n>>>>>>>>> theirs\n',
    );
  });
});

describe('runMergeDriver', () => {
  async function run(
    base: string,
    ours: string,
    theirs: string,
    path = '.issues/1-login-times-out.md',
  ) {
    const files = {
      base: join(dir, 'O'),
      ours: join(dir, 'A'),
      theirs: join(dir, 'B'),
    };
    await writeFile(files.base, base);
    await writeFile(files.ours, ours);
    await writeFile(files.theirs, theirs);
    const result = await runMergeDriver({ ...files, path });
    return { ...result, content: await readFile(files.ours, 'utf-8') };
  }

  test('merges issue files cleanly into %A', async () => {
    const result = await run(
      serializeIssue(issue()),
      serializeIssue(
        issue({
          description: 'ONE\ntwo\nthree\nfour\nfive',
          updated: '2025-01-02T00:00:00Z',
          comments: [
            { author: 'a', timestamp: '2025-01-02T00:00:00Z', body: 'ours' },
          ],
        }),
      ),
      serializeIssue(
        issue({
          status: 'in_progress',
          description: 'one\ntwo\nthree\nfour\nFIVE',
          updated: '2025-01-03T00:00:00Z',
          comments: [
            { author: 'b', timestamp: '2025-01-03T00:00:00Z', body: 'theirs' },
          ],
        }),
      ),
    );
    expect(result).toMatchObject({
      kind: 'issue',
      conflict: false,
      fallbackReason: null,
    });
    const merged = parseIssue(result.content);
    expect(merged.description).toBe('ONE\ntwo\nthree\nfour\nFIVE');
    expect(merged.status).toBe('in_progress');
    expect(merged.updated).toBe('2025-01-03T00:00:00Z');
    expect(merged.comments.map((c) => c.body)).toEqual(['ours', 'theirs']);
  });

  test('a description conflict keeps the merged rest and reports a conflict', async () => {
    const result = await run(
      serializeIssue(issue()),
      serializeIssue(issue({ priority: 'high', description: 'ours' })),
      serializeIssue(
        issue({
          description: 'theirs',
          comments: [
            { author: 'b', timestamp: '2025-01-03T00:00:00Z', body: 'hi' },
          ],
        }),
      ),
    );
    expect(result.conflict).toBe(true);
    expect(result.fallbackReason).toBeNull();
    expect(result.content).toContain('priority: high');
    expect(result.content).toContain(
      '<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n',
    );
    expect(result.content).toContain('### b \u2014 2025-01-03T00:00:00Z');
  });

  test('falls back to a line merge (markers) for unparseable issues', async () => {
    const base = serializeIssue(issue());
    const theirs = serializeIssue(issue({ status: 'done' }));
    const ours = base
      .replace('id: 1', 'id: [broken')
      .replace('todo', 'backlog');
    const result = await run(base, ours, theirs);
    expect(result.kind).toBe('issue');
    expect(result.conflict).toBe(true);
    expect(result.fallbackReason).toBeString();
    expect(result.content).toContain('<<<<<<< ours');
    expect(result.content).toContain('id: [broken');
    expect(result.content).toContain('status: done');
  });

  test('a clean fallback line merge is not a conflict', async () => {
    const result = await run(
      'a\nb\nc\n',
      'A\nb\nc\n',
      'a\nb\nC\n',
      'other.txt',
    );
    expect(result).toMatchObject({ kind: 'text', conflict: false });
    expect(result.content).toBe('A\nb\nC\n');
  });

  test('merges config.yaml', async () => {
    const config = createDefaultConfig();
    const result = await run(
      serializeConfig({ ...config, nextId: 5 }),
      serializeConfig({
        ...config,
        nextId: 8,
        labels: { ...config.labels, a: '#000001' },
      }),
      serializeConfig({
        ...config,
        nextId: 6,
        labels: { ...config.labels, b: '#000002' },
      }),
      '.issues/config.yaml',
    );
    expect(result).toMatchObject({ kind: 'config', conflict: false });
    expect(result.content).toContain('nextId: 8');
    expect(result.content).toContain("a: '#000001'");
    expect(result.content).toContain("b: '#000002'");
  });
});

describe('install helpers', () => {
  test('shellQuote quotes only when needed', () => {
    expect(shellQuote('/usr/bin/gitrac')).toBe('/usr/bin/gitrac');
    expect(shellQuote("/my dir/it's")).toBe(`'/my dir/it'\\''s'`);
  });

  test('mergeDriverConfigValue passes all of git’s placeholders', () => {
    expect(mergeDriverConfigValue('gitrac')).toBe(
      'gitrac merge-driver --marker-size %L %O %A %B %P',
    );
  });

  test('writeMergeAttributes is idempotent and keeps other lines', async () => {
    await mkdir(join(dir, '.issues'));
    expect(await writeMergeAttributes(dir)).toBe(true);
    const first = await readFile(join(dir, GITATTRIBUTES_PATH), 'utf-8');
    expect(first).toContain('*.md merge=gitrac\nconfig.yaml merge=gitrac\n');
    expect(await writeMergeAttributes(dir)).toBe(false);

    await writeFile(
      join(dir, GITATTRIBUTES_PATH),
      '*.png binary\n*.md   merge=gitrac',
    );
    expect(await writeMergeAttributes(dir)).toBe(true);
    expect(await readFile(join(dir, GITATTRIBUTES_PATH), 'utf-8')).toBe(
      '*.png binary\n*.md   merge=gitrac\nconfig.yaml merge=gitrac\n',
    );
  });

  test('configureMergeDriver writes the local git config (only in a repo)', async () => {
    expect(await configureMergeDriver(dir, 'gitrac')).toBe(false);
    await simpleGit(dir).init();
    expect(await configureMergeDriver(dir, 'gitrac')).toBe(true);
    const value = await simpleGit(dir).getConfig(
      'merge.gitrac.driver',
      'local',
    );
    expect(value.value).toBe(mergeDriverConfigValue('gitrac'));
  });
});

describe('git merge with the driver installed', () => {
  const path = join('.issues', '1-login-times-out.md');
  let git: ReturnType<typeof simpleGit>;

  async function writeIssue(i: Issue, rel = path): Promise<void> {
    await mkdir(join(dir, rel, '..'), { recursive: true });
    await writeFile(join(dir, rel), serializeIssue(i));
  }

  async function commitAll(message: string): Promise<void> {
    await git.add(['-A']);
    await git.commit(message);
  }

  /** Merge `other` into main; true if it merged cleanly. */
  async function merge(): Promise<boolean> {
    return git.merge(['other', '-m', 'merge']).then(
      () => true,
      () => false,
    );
  }

  beforeEach(async () => {
    git = simpleGit(dir);
    await git.init(['-b', 'main']);
    await git.addConfig('user.email', 't@example.com');
    await git.addConfig('user.name', 'T');
    await git.addConfig('commit.gpgsign', 'false');
    await mkdir(join(dir, '.issues'));
    await writeFile(
      join(dir, '.issues', 'config.yaml'),
      serializeConfig(createDefaultConfig()),
    );
    await writeMergeAttributes(dir);
    await configureMergeDriver(
      dir,
      `${shellQuote(process.execPath)} ${shellQuote(INDEX_TS)}`,
    );
    await writeIssue(issue());
    await commitAll('base');
    await git.checkoutLocalBranch('other');
  });

  test('comments and field edits on both branches merge cleanly', async () => {
    await writeIssue(
      issue({
        status: 'in_progress',
        assignee: 'bob',
        updated: '2025-01-03T00:00:00Z',
        comments: [
          { author: 'bob', timestamp: '2025-01-03T00:00:00Z', body: 'b' },
        ],
      }),
    );
    await commitAll('theirs');
    await git.checkout('main');
    await writeIssue(
      issue({
        priority: 'high',
        labels: ['bug'],
        updated: '2025-01-02T00:00:00Z',
        comments: [
          { author: 'ada', timestamp: '2025-01-02T00:00:00Z', body: 'a' },
        ],
      }),
    );
    await commitAll('ours');

    expect(await merge()).toBe(true);
    const merged = parseIssue(await readFile(join(dir, path), 'utf-8'));
    expect(merged).toMatchObject({
      status: 'in_progress',
      assignee: 'bob',
      priority: 'high',
      labels: ['bug'],
      updated: '2025-01-03T00:00:00Z',
    });
    expect(merged.comments.map((c) => c.author)).toEqual(['ada', 'bob']);
  });

  test('a title change (rename) on one side merges into the new file', async () => {
    const renamed = join('.issues', '1-login-is-slow.md');
    await rm(join(dir, path));
    await writeIssue(
      issue({ title: 'Login is slow', updated: '2025-01-03T00:00:00Z' }),
      renamed,
    );
    await commitAll('rename');
    await git.checkout('main');
    await writeIssue(
      issue({
        comments: [
          { author: 'ada', timestamp: '2025-01-02T00:00:00Z', body: 'a' },
        ],
      }),
    );
    await commitAll('comment');

    expect(await merge()).toBe(true);
    const merged = parseIssue(await readFile(join(dir, renamed), 'utf-8'));
    expect(merged.title).toBe('Login is slow');
    expect(merged.comments).toHaveLength(1);
    expect(await Bun.file(join(dir, path)).exists()).toBe(false);
  });

  test('conflicting description edits stop the merge with markers', async () => {
    await writeIssue(issue({ description: 'theirs', status: 'done' }));
    await commitAll('theirs');
    await git.checkout('main');
    await writeIssue(issue({ description: 'ours' }));
    await commitAll('ours');

    expect(await merge()).toBe(false);
    const status = await git.status();
    expect(status.conflicted).toEqual([path]);
    const content = await readFile(join(dir, path), 'utf-8');
    expect(content).toContain('status: done');
    expect(content).toContain(
      '<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs',
    );
  });

  test('config.yaml label additions on both sides merge cleanly', async () => {
    const config = createDefaultConfig();
    const configPath = join(dir, '.issues', 'config.yaml');
    await writeFile(
      configPath,
      serializeConfig({
        ...config,
        labels: { ...config.labels, api: '#123456' },
      }),
    );
    await commitAll('theirs label');
    await git.checkout('main');
    await writeFile(
      configPath,
      serializeConfig({
        ...config,
        labels: { ...config.labels, ui: '#654321' },
      }),
    );
    await commitAll('ours label');

    expect(await merge()).toBe(true);
    const content = await readFile(configPath, 'utf-8');
    expect(content).toContain("api: '#123456'");
    expect(content).toContain("ui: '#654321'");
  });
});
