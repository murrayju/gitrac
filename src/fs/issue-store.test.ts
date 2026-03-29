import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultConfig } from '../core/config.ts';
import { serializeIssue } from '../core/issue.ts';
import type { Issue } from '../core/types.ts';
import {
  allocateNextId,
  deleteIssueFile,
  findIssueFile,
  initIssuesDir,
  listAllIssueFiles,
  listClosedIssueFiles,
  listIssueFiles,
  moveToClose,
  moveToReopen,
  readConfig,
  readIssue,
  writeConfig,
  writeIssue,
} from './issue-store.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 1,
    title: 'Test Issue',
    status: 'backlog',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2025-01-01T00:00:00Z',
    createdBy: 'tester',
    updated: '2025-01-01T00:00:00Z',
    description: 'A test issue description.',
    comments: [],
    ...overrides,
  };
}

describe('initIssuesDir', () => {
  test('creates .issues dir and config.yaml', async () => {
    await initIssuesDir(dir);
    const configYaml = await readFile(
      join(dir, '.issues', 'config.yaml'),
      'utf-8',
    );
    expect(configYaml).toContain('version:');
    expect(configYaml).toContain('nextId:');
  });

  test('creates closed subdirectory', async () => {
    await initIssuesDir(dir);
    const info = await stat(join(dir, '.issues', 'closed'));
    expect(info.isDirectory()).toBe(true);
  });

  test('throws if .issues already exists (without force)', async () => {
    await initIssuesDir(dir);
    expect(initIssuesDir(dir)).rejects.toThrow();
  });

  test('overwrites if force is true', async () => {
    await initIssuesDir(dir);
    await initIssuesDir(dir, { force: true });
    const configYaml = await readFile(
      join(dir, '.issues', 'config.yaml'),
      'utf-8',
    );
    expect(configYaml).toContain('version:');
  });
});

describe('readConfig / writeConfig', () => {
  test('reads default config after init', async () => {
    await initIssuesDir(dir);
    const config = await readConfig(dir);
    expect(config.version).toBe(1);
    expect(config.nextId).toBe(1);
    expect(config.statuses).toContain('backlog');
  });

  test('writes and reads back config', async () => {
    await initIssuesDir(dir);
    const config = createDefaultConfig();
    config.nextId = 42;
    await writeConfig(dir, config);
    const read = await readConfig(dir);
    expect(read.nextId).toBe(42);
  });
});

describe('writeIssue / readIssue', () => {
  test('writes and reads back an issue', async () => {
    await initIssuesDir(dir);
    const issue = makeIssue({ id: 1, title: 'First Bug' });
    const filename = await writeIssue(dir, issue);
    expect(filename).toBe('1-first-bug.md');
    const readBack = await readIssue(dir, 1);
    expect(readBack.id).toBe(1);
    expect(readBack.title).toBe('First Bug');
    expect(readBack.description).toBe('A test issue description.');
  });

  test('writes issue with comments', async () => {
    await initIssuesDir(dir);
    const issue = makeIssue({
      id: 2,
      title: 'With Comments',
      comments: [
        { author: 'alice', timestamp: '2025-01-02T00:00:00Z', body: 'hello' },
      ],
    });
    await writeIssue(dir, issue);
    const readBack = await readIssue(dir, 2);
    expect(readBack.comments).toHaveLength(1);
    expect(readBack.comments[0]?.author).toBe('alice');
  });
});

describe('listIssueFiles', () => {
  test('lists only .md files in .issues/', async () => {
    await initIssuesDir(dir);
    await writeIssue(dir, makeIssue({ id: 1, title: 'One' }));
    await writeIssue(dir, makeIssue({ id: 2, title: 'Two' }));
    const files = await listIssueFiles(dir);
    expect(files).toHaveLength(2);
    expect(files).toContain('1-one.md');
    expect(files).toContain('2-two.md');
  });

  test('does not include config.yaml', async () => {
    await initIssuesDir(dir);
    await writeIssue(dir, makeIssue({ id: 1, title: 'One' }));
    const files = await listIssueFiles(dir);
    expect(files).not.toContain('config.yaml');
  });

  test('does not include closed issues', async () => {
    await initIssuesDir(dir);
    await writeIssue(dir, makeIssue({ id: 1, title: 'Open' }));
    // Manually write a closed issue
    const closedDir = join(dir, '.issues', 'closed');
    const closedContent = serializeIssue(
      makeIssue({ id: 2, title: 'Closed', status: 'done' }),
    );
    await writeFile(join(closedDir, '2-closed.md'), closedContent);
    const files = await listIssueFiles(dir);
    expect(files).toHaveLength(1);
    expect(files).toContain('1-open.md');
  });
});

describe('listClosedIssueFiles', () => {
  test('lists only .md files in .issues/closed/', async () => {
    await initIssuesDir(dir);
    const closedDir = join(dir, '.issues', 'closed');
    const content = serializeIssue(makeIssue({ id: 1, title: 'Done' }));
    await writeFile(join(closedDir, '1-done.md'), content);
    const files = await listClosedIssueFiles(dir);
    expect(files).toHaveLength(1);
    expect(files).toContain('1-done.md');
  });

  test('returns empty array when no closed issues', async () => {
    await initIssuesDir(dir);
    const files = await listClosedIssueFiles(dir);
    expect(files).toHaveLength(0);
  });
});

describe('listAllIssueFiles', () => {
  test('returns both open and closed files', async () => {
    await initIssuesDir(dir);
    await writeIssue(dir, makeIssue({ id: 1, title: 'Open' }));
    const closedDir = join(dir, '.issues', 'closed');
    const content = serializeIssue(
      makeIssue({ id: 2, title: 'Closed', status: 'done' }),
    );
    await writeFile(join(closedDir, '2-closed.md'), content);
    const files = await listAllIssueFiles(dir);
    expect(files).toHaveLength(2);
  });
});

describe('findIssueFile', () => {
  test('finds open issue by id', async () => {
    await initIssuesDir(dir);
    await writeIssue(dir, makeIssue({ id: 1, title: 'Open One' }));
    const result = await findIssueFile(dir, 1);
    expect(result).not.toBeNull();
    expect(result?.filename).toBe('1-open-one.md');
    expect(result?.closed).toBe(false);
  });

  test('finds closed issue by id', async () => {
    await initIssuesDir(dir);
    const closedDir = join(dir, '.issues', 'closed');
    const content = serializeIssue(makeIssue({ id: 3, title: 'Closed One' }));
    await writeFile(join(closedDir, '3-closed-one.md'), content);
    const result = await findIssueFile(dir, 3);
    expect(result).not.toBeNull();
    expect(result?.filename).toBe('3-closed-one.md');
    expect(result?.closed).toBe(true);
  });

  test('returns null for non-existent id', async () => {
    await initIssuesDir(dir);
    const result = await findIssueFile(dir, 999);
    expect(result).toBeNull();
  });
});

describe('moveToClose', () => {
  test('moves issue from .issues/ to .issues/closed/', async () => {
    await initIssuesDir(dir);
    await writeIssue(dir, makeIssue({ id: 1, title: 'To Close' }));
    await moveToClose(dir, 1);
    const open = await listIssueFiles(dir);
    const closed = await listClosedIssueFiles(dir);
    expect(open).toHaveLength(0);
    expect(closed).toContain('1-to-close.md');
  });

  test('throws if issue not found', async () => {
    await initIssuesDir(dir);
    expect(moveToClose(dir, 999)).rejects.toThrow();
  });
});

describe('moveToReopen', () => {
  test('moves issue from .issues/closed/ back to .issues/', async () => {
    await initIssuesDir(dir);
    await writeIssue(dir, makeIssue({ id: 1, title: 'To Reopen' }));
    await moveToClose(dir, 1);
    await moveToReopen(dir, 1);
    const open = await listIssueFiles(dir);
    const closed = await listClosedIssueFiles(dir);
    expect(open).toContain('1-to-reopen.md');
    expect(closed).toHaveLength(0);
  });

  test('throws if issue not found in closed', async () => {
    await initIssuesDir(dir);
    expect(moveToReopen(dir, 999)).rejects.toThrow();
  });
});

describe('allocateNextId', () => {
  test('returns 1 for fresh project and increments', async () => {
    await initIssuesDir(dir);
    const id1 = await allocateNextId(dir);
    expect(id1).toBe(1);
    const config = await readConfig(dir);
    expect(config.nextId).toBe(2);
  });

  test('increments sequentially', async () => {
    await initIssuesDir(dir);
    const id1 = await allocateNextId(dir);
    const id2 = await allocateNextId(dir);
    const id3 = await allocateNextId(dir);
    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(id3).toBe(3);
  });
});

describe('writeIssue with closed option', () => {
  test('writes to .issues/ by default', async () => {
    await initIssuesDir(dir);
    const issue = makeIssue({ id: 1, title: 'Open Issue' });
    const filename = await writeIssue(dir, issue);
    expect(filename).toBe('1-open-issue.md');

    const openFiles = await listIssueFiles(dir);
    expect(openFiles).toContain('1-open-issue.md');

    const closedFiles = await listClosedIssueFiles(dir);
    expect(closedFiles).not.toContain('1-open-issue.md');
  });

  test('writes to .issues/closed/ when closed is true', async () => {
    await initIssuesDir(dir);
    const issue = makeIssue({ id: 1, title: 'Closed Issue', status: 'done' });
    const filename = await writeIssue(dir, issue, { closed: true });
    expect(filename).toBe('1-closed-issue.md');

    const closedFiles = await listClosedIssueFiles(dir);
    expect(closedFiles).toContain('1-closed-issue.md');

    const openFiles = await listIssueFiles(dir);
    expect(openFiles).not.toContain('1-closed-issue.md');
  });

  test('writes to .issues/ when closed is false', async () => {
    await initIssuesDir(dir);
    const issue = makeIssue({ id: 1, title: 'Open Issue' });
    const filename = await writeIssue(dir, issue, { closed: false });
    expect(filename).toBe('1-open-issue.md');

    const openFiles = await listIssueFiles(dir);
    expect(openFiles).toContain('1-open-issue.md');
  });
});

describe('deleteIssueFile', () => {
  test('deletes a file from .issues/', async () => {
    await initIssuesDir(dir);
    await writeIssue(dir, makeIssue({ id: 1, title: 'To Delete' }));
    const openBefore = await listIssueFiles(dir);
    expect(openBefore).toContain('1-to-delete.md');

    await deleteIssueFile(dir, '1-to-delete.md', false);
    const openAfter = await listIssueFiles(dir);
    expect(openAfter).not.toContain('1-to-delete.md');
  });

  test('deletes a file from .issues/closed/', async () => {
    await initIssuesDir(dir);
    await writeIssue(dir, makeIssue({ id: 1, title: 'Closed' }), {
      closed: true,
    });
    const closedBefore = await listClosedIssueFiles(dir);
    expect(closedBefore).toContain('1-closed.md');

    await deleteIssueFile(dir, '1-closed.md', true);
    const closedAfter = await listClosedIssueFiles(dir);
    expect(closedAfter).not.toContain('1-closed.md');
  });

  test('silently ignores non-existent file', async () => {
    await initIssuesDir(dir);
    // Should not throw
    await deleteIssueFile(dir, 'nonexistent.md', false);
    await deleteIssueFile(dir, 'nonexistent.md', true);
  });
});
