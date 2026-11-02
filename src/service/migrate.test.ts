import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_VERSION } from '../core/config.ts';
import { readConfig, writeConfig } from '../fs/issue-store.ts';
import { migrateProject } from './migrate.ts';
import { type ServiceFixture, serviceFixture } from './test-helpers.fixture.ts';

/** Regression tests for #127: migrating `.issues/` to config version 2. */

let fx: ServiceFixture;

const ISSUE = (id: number, extra: string) => `---
id: ${id}
title: Issue ${id}
status: todo
priority: medium
assignee: ''
labels: []
${extra}created: '2025-01-01T00:00:00Z'
createdBy: tester
updated: '2025-01-01T00:00:00Z'
---

Body
`;

const read = (path: string) => readFile(join(fx.dir, path), 'utf-8');

beforeEach(async () => {
  fx = await serviceFixture();
  const config = await readConfig(fx.dir);
  config.version = 1;
  await writeConfig(fx.dir, config);
  await mkdir(join(fx.dir, '.issues', 'closed'), { recursive: true });
  await writeFile(
    join(fx.dir, '.issues', '1-issue-1.md'),
    ISSUE(1, 'parent: 3\nblockedBy:\n  - 2\n'),
  );
  await writeFile(join(fx.dir, '.issues', '2-issue-2.md'), ISSUE(2, ''));
  await writeFile(
    join(fx.dir, '.issues', 'closed', '3-issue-3.md'),
    ISSUE(3, 'duplicateOf: 2\n').replace('status: todo', 'status: done'),
  );
  await writeFile(join(fx.dir, '.issues', '4-bad.md'), 'no frontmatter\n');
});

afterEach(async () => {
  await fx.cleanup();
});

describe('migrateProject', () => {
  test('rewrites the files with old fields, bumps the version, commits once', async () => {
    const migration = await migrateProject(fx.context());
    expect(migration).toEqual({
      from: 1,
      to: CONFIG_VERSION,
      paths: [
        join('.issues', '1-issue-1.md'),
        join('.issues', 'closed', '3-issue-3.md'),
        join('.issues', 'config.yaml'),
      ],
      commit: 'abc123',
    });
    expect(await read('.issues/1-issue-1.md')).toBe(
      ISSUE(
        1,
        'links:\n  - type: issue\n    relationship: parent\n    id: 3\n  - type: issue\n    relationship: blockedBy\n    id: 2\n',
      ),
    );
    expect(await read('.issues/closed/3-issue-3.md')).toContain(
      'links:\n  - type: issue\n    relationship: duplicateOf\n    id: 2\n',
    );
    // Unchanged: no old fields, or malformed.
    expect(await read('.issues/2-issue-2.md')).toBe(ISSUE(2, ''));
    expect(await read('.issues/4-bad.md')).toBe('no frontmatter\n');
    expect((await readConfig(fx.dir)).version).toBe(CONFIG_VERSION);
    expect(fx.commits).toMatchObject([
      {
        operation: 'migrate',
        message: `issue: migrate .issues to version ${CONFIG_VERSION}`,
        issueId: null,
        files: migration?.paths,
      },
    ]);
  });

  test('runs once', async () => {
    await migrateProject(fx.context());
    expect(await migrateProject(fx.context())).toBeNull();
    expect(fx.commits).toHaveLength(1);
  });

  test('respects noCommit', async () => {
    const migration = await migrateProject(fx.context({ noCommit: true }));
    expect(migration?.commit).toBeNull();
    expect(fx.commits).toEqual([]);
    expect((await readConfig(fx.dir)).version).toBe(CONFIG_VERSION);
  });
});
