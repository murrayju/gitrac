import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitracError } from '../core/errors.ts';
import { serializeIssue } from '../core/issue.ts';
import { findIssueFile, writeIssue } from '../fs/issue-store.ts';
import { deleteIssue } from './delete.ts';
import {
  makeIssue,
  type ServiceFixture,
  serviceFixture,
} from './test-helpers.fixture.ts';

/** Regression tests for #59: deleting an issue. */

let fx: ServiceFixture;

beforeEach(async () => {
  fx = await serviceFixture();
  await mkdir(join(fx.dir, '.issues', 'assets'), { recursive: true });
});

afterEach(async () => {
  await fx.cleanup();
});

async function rejection(promise: Promise<unknown>): Promise<GitracError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(GitracError);
    return err as GitracError;
  }
  throw new Error('expected a rejection');
}

/** Every file under .issues/ with its contents. */
async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const root = join(fx.dir, '.issues');
  for (const entry of await readdir(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out[path] = await Bun.file(path).text();
  }
  return out;
}

function asset(name: string): string {
  return join(fx.dir, '.issues', 'assets', name);
}

async function writeAsset(name: string): Promise<void> {
  await writeFile(asset(name), 'img');
}

const ref = (name: string) => `![${name}](/.issues/assets/${name})`;

describe('deleteIssue', () => {
  test('removes an open issue and commits the deletion', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Dupe' }));
    await writeIssue(fx.dir, makeIssue({ id: 2, title: 'Keep' }));

    const result = await deleteIssue(fx.context(), 1);

    expect(result.issue.title).toBe('Dupe');
    expect(result.paths).toEqual([join('.issues', '1-dupe.md')]);
    expect(result.assets).toEqual([]);
    expect(result.commit).toBe('abc123');
    expect(await findIssueFile(fx.dir, 1)).toBeNull();
    expect(await findIssueFile(fx.dir, 2)).not.toBeNull();
    expect(fx.events).toEqual(['written:delete', 'commit:delete']);
    expect(fx.commits[0]).toMatchObject({
      operation: 'delete',
      issueId: 1,
      files: [join('.issues', '1-dupe.md')],
      message: 'issue: delete #1 Dupe',
    });
  });

  test('removes a closed issue', async () => {
    await writeIssue(
      fx.dir,
      makeIssue({ id: 3, title: 'Old', status: 'done' }),
      {
        closed: true,
      },
    );
    const result = await deleteIssue(fx.context(), 3);
    expect(result.paths).toEqual([join('.issues', 'closed', '3-old.md')]);
    expect(await findIssueFile(fx.dir, 3)).toBeNull();
  });

  test('removes only the assets no other issue or draft references', async () => {
    for (const name of ['only.png', 'shared.png', 'drafted.png', 'b.png']) {
      await writeAsset(name);
    }
    await writeIssue(
      fx.dir,
      makeIssue({
        id: 1,
        title: 'Has images',
        description: `${ref('only.png')} ${ref('shared.png')} ${ref('missing.png')}`,
        comments: [
          {
            author: 'a',
            timestamp: '2025-01-01T00:00:00Z',
            body: `${ref('drafted.png')} ${ref('b.png')} /.issues/assets/../config.yaml`,
          },
        ],
      }),
    );
    // shared.png is also used by a closed issue, drafted.png by a draft
    await writeIssue(
      fx.dir,
      makeIssue({ id: 2, status: 'done', description: ref('shared.png') }),
      { closed: true },
    );
    await mkdir(join(fx.dir, '.issues', 'drafts'), { recursive: true });
    await writeFile(
      join(fx.dir, '.issues', 'drafts', 'x.json'),
      JSON.stringify({ description: ref('drafted.png') }),
    );

    const result = await deleteIssue(fx.context(), 1);

    const expected = [
      join('.issues', 'assets', 'b.png'),
      join('.issues', 'assets', 'only.png'),
    ];
    expect(result.assets).toEqual(expected);
    expect(result.paths).toEqual([
      join('.issues', '1-has-images.md'),
      ...expected,
    ]);
    expect(fx.commits[0]?.files).toEqual(result.paths);
    expect(await Bun.file(asset('only.png')).exists()).toBe(false);
    expect(await Bun.file(asset('b.png')).exists()).toBe(false);
    expect(await Bun.file(asset('shared.png')).exists()).toBe(true);
    expect(await Bun.file(asset('drafted.png')).exists()).toBe(true);
    // A traversal "ref" never touches files outside .issues/assets/
    expect(
      await Bun.file(join(fx.dir, '.issues', 'config.yaml')).exists(),
    ).toBe(true);
  });

  test('dryRun reports the plan without touching disk or committing', async () => {
    await writeAsset('only.png');
    await writeIssue(
      fx.dir,
      makeIssue({ id: 1, title: 'Plan', description: ref('only.png') }),
    );
    const before = await snapshot();

    const plan = await deleteIssue(fx.context(), 1, { dryRun: true });

    expect(plan.paths).toEqual([
      join('.issues', '1-plan.md'),
      join('.issues', 'assets', 'only.png'),
    ]);
    expect(plan.commit).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(fx.events).toEqual([]);
  });

  test('noCommit deletes the files but does not commit', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1 }));
    const result = await deleteIssue(fx.context({ noCommit: true }), 1);
    expect(result.commit).toBeNull();
    expect(await findIssueFile(fx.dir, 1)).toBeNull();
    expect(fx.events).toEqual(['written:delete']);
  });

  test('a missing issue is not_found', async () => {
    const err = await rejection(deleteIssue(fx.context(), 9));
    expect(err.code).toBe('not_found');
  });

  test('a failing precondition deletes nothing', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1 }));
    const before = await snapshot();
    const err = await rejection(
      deleteIssue(fx.context(), 1, {
        precondition: () => {
          throw new GitracError('invalid_state', 'changed');
        },
      }),
    );
    expect(err.code).toBe('invalid_state');
    expect(await snapshot()).toEqual(before);
    expect(fx.events).toEqual([]);
  });

  test('several files for the ID is duplicate_issue, nothing deleted', async () => {
    const issue = makeIssue({ id: 1, title: 'Twice' });
    await writeIssue(fx.dir, issue);
    await writeFile(
      join(fx.dir, '.issues', '1-old-name.md'),
      serializeIssue(issue),
    );
    const before = await snapshot();
    const err = await rejection(deleteIssue(fx.context(), 1));
    expect(err.code).toBe('duplicate_issue');
    expect(await snapshot()).toEqual(before);
  });
});
