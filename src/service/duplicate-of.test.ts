import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readIssue, writeIssue } from '../fs/issue-store.ts';
import { claimIssue } from './claim.ts';
import { deleteIssue } from './delete.ts';
import { ValidationError } from './errors.ts';
import { closeIssue, reopenIssue, updateIssue } from './issues.ts';
import { renumberIssue } from './renumber.ts';
import {
  makeIssue,
  type ServiceFixture,
  serviceFixture,
} from './test-helpers.fixture.ts';

/** Regression tests for #127: closing an issue as a duplicate of another. */

let fx: ServiceFixture;

beforeEach(async () => {
  fx = await serviceFixture();
  await mkdir(join(fx.dir, '.issues', 'closed'), { recursive: true });
  await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Original' }));
  await writeIssue(fx.dir, makeIssue({ id: 2, title: 'Copy' }));
});

afterEach(async () => {
  await fx.cleanup();
});

async function validationErrors(promise: Promise<unknown>): Promise<string[]> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return (err as ValidationError).errors;
  }
  throw new Error('expected a rejection');
}

async function closedFiles(): Promise<string[]> {
  return (await readdir(join(fx.dir, '.issues', 'closed'))).sort();
}

describe('closeIssue with duplicateOf', () => {
  test('sets the duplicate status and the link, and moves the file', async () => {
    const result = await closeIssue(fx.context(), 2, {
      duplicateOf: '#1',
      comment: 'Same bug',
    });
    expect(result.issue).toMatchObject({
      status: 'duplicate',
      duplicateOf: 1,
    });
    expect(result.issue.comments.map((c) => c.body)).toEqual(['Same bug']);
    expect(await closedFiles()).toEqual(['2-copy.md']);
    expect((await readIssue(fx.dir, 2)).duplicateOf).toBe(1);
    expect(fx.commits.map((c) => c.message)).toEqual(['issue: close #2 Copy']);
  });

  test('rejects bad input before writing anything', async () => {
    expect(
      await validationErrors(closeIssue(fx.context(), 2, { duplicateOf: 'x' })),
    ).toEqual(['Invalid duplicateOf: must be an issue ID']);
    expect(
      await validationErrors(closeIssue(fx.context(), 2, { duplicateOf: 2 })),
    ).toEqual(["Issue #2 can't be a duplicate of itself"]);
    expect(
      await validationErrors(closeIssue(fx.context(), 2, { duplicateOf: 9 })),
    ).toEqual(['Issue #9 not found (duplicate-of of #2)']);
    expect(
      (
        await validationErrors(
          closeIssue(fx.context(), 2, { duplicateOf: 1, cancelled: true }),
        )
      )[0],
    ).toContain('Give only one of');
    await closeIssue(fx.context(), 2, { duplicateOf: 1 });
    await expect(
      closeIssue(fx.context(), 1, { duplicateOf: 2 }),
    ).rejects.toThrow('would create a cycle (#1 → #2 → #1)');
    expect(fx.commits).toHaveLength(1);
  });
});

describe('updateIssue with duplicateOf', () => {
  test('sets the status and the link together, also on a closed issue', async () => {
    await closeIssue(fx.context(), 2);
    const { issue } = await updateIssue(fx.context(), 2, {
      status: 'duplicate',
      duplicateOf: 1,
    });
    expect(issue).toMatchObject({ status: 'duplicate', duplicateOf: 1 });
    expect(await closedFiles()).toEqual(['2-copy.md']);
  });

  test('changes the link of a duplicate; needs the duplicate status', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 3, title: 'Third' }));
    await closeIssue(fx.context(), 2, { duplicateOf: 1 });
    const { issue } = await updateIssue(fx.context(), 2, { duplicateOf: 3 });
    expect(issue.duplicateOf).toBe(3);
    expect(
      await validationErrors(updateIssue(fx.context(), 3, { duplicateOf: 1 })),
    ).toEqual(['duplicateOf needs the status duplicate']);
    expect(
      await validationErrors(
        updateIssue(fx.context(), 2, { status: 'done', duplicateOf: 1 }),
      ),
    ).toEqual(['duplicateOf needs the status duplicate']);
  });
});

describe('the link is dropped when the issue leaves the duplicate status', () => {
  beforeEach(async () => {
    await closeIssue(fx.context(), 2, { duplicateOf: 1 });
  });

  test('reopen', async () => {
    const { issue } = await reopenIssue(fx.context(), 2);
    expect('duplicateOf' in issue).toBe(false);
    expect('duplicateOf' in (await readIssue(fx.dir, 2))).toBe(false);
  });

  test('a status edit', async () => {
    const { issue } = await updateIssue(fx.context(), 2, { status: 'done' });
    expect('duplicateOf' in issue).toBe(false);
  });

  test('a forced claim', async () => {
    const { issue } = await claimIssue(fx.context(), 2, { force: true });
    expect('duplicateOf' in issue).toBe(false);
  });

  test('but not other edits', async () => {
    const { issue } = await updateIssue(fx.context(), 2, { priority: 'high' });
    expect(issue.duplicateOf).toBe(1);
  });
});

describe('other operations treat duplicateOf as a link', () => {
  beforeEach(async () => {
    await closeIssue(fx.context(), 2, { duplicateOf: 1 });
  });

  test('deleting the original clears the link', async () => {
    const result = await deleteIssue(fx.context(), 1);
    expect(result.unlinked).toMatchObject([
      { id: 2, blockedBy: false, parent: false, duplicateOf: true },
    ]);
    const copy = await readIssue(fx.dir, 2);
    expect('duplicateOf' in copy).toBe(false);
    expect(copy.status).toBe('duplicate');
  });

  test('renumber reports it, and --update-refs repoints it', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Twin' }));
    const original = join('.issues', '1-original.md');
    const reported = await renumberIssue(fx.context({ noCommit: true }), 1, {
      file: join('.issues', '1-twin.md'),
    });
    expect(reported.references).toMatchObject([
      { id: 2, duplicateOf: true, updated: false },
    ]);
    expect((await readIssue(fx.dir, 2)).duplicateOf).toBe(1);

    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Twin' }));
    const repointed = await renumberIssue(fx.context(), 1, {
      file: original,
      updateRefs: true,
    });
    expect(repointed.references).toMatchObject([
      { id: 2, duplicateOf: true, updated: true },
      // The first renumber's comment mentions #1.
      { id: 3, duplicateOf: false, mentions: true },
    ]);
    expect((await readIssue(fx.dir, 2)).duplicateOf).toBe(repointed.newId);
  });
});
