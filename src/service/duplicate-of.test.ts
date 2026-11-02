import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { issueLinks } from '../core/links.fixture.ts';
import { readIssue, writeIssue } from '../fs/issue-store.ts';
import { deleteIssue } from './delete.ts';
import { ValidationError } from './errors.ts';
import { closeIssue, reopenIssue } from './issues.ts';
import { linkIssue, unlinkIssue } from './links.ts';
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
    expect(result.issue.status).toBe('duplicate');
    expect(result.issue.links).toEqual(issueLinks({ duplicateOf: 1 }));
    expect(result.issue.comments.map((c) => c.body)).toEqual(['Same bug']);
    expect(await closedFiles()).toEqual(['2-copy.md']);
    expect((await readIssue(fx.dir, 2)).links).toEqual(
      issueLinks({ duplicateOf: 1 }),
    );
    expect(fx.commits.map((c) => c.message)).toEqual(['issue: close #2 Copy']);
  });

  test('rejects bad input before writing anything', async () => {
    expect(
      await validationErrors(closeIssue(fx.context(), 2, { duplicateOf: 'x' })),
    ).toEqual(['Invalid duplicateOf: must be an issue ID']);
    expect(
      await validationErrors(closeIssue(fx.context(), 2, { duplicateOf: 2 })),
    ).toEqual(["Issue #2 can't be linked to itself"]);
    expect(
      await validationErrors(closeIssue(fx.context(), 2, { duplicateOf: 9 })),
    ).toEqual(['Issue #9 not found (duplicateOf of #2)']);
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
    ).rejects.toThrow('would create a cycle (#1 duplicates #2 duplicates #1)');
    expect(fx.commits).toHaveLength(1);
  });
});

describe('the link does not depend on the status', () => {
  test('reopening keeps it; unlink removes it', async () => {
    await closeIssue(fx.context(), 2, { duplicateOf: 1 });
    const { issue } = await reopenIssue(fx.context(), 2);
    expect(issue.links).toEqual(issueLinks({ duplicateOf: 1 }));
    await unlinkIssue(fx.context(), 2, {
      links: [{ type: 'issue', relationship: 'duplicateOf' }],
    });
    expect((await readIssue(fx.dir, 2)).links).toBeUndefined();
  });

  test('closing as a duplicate of another issue replaces the original', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 3, title: 'Third' }));
    await linkIssue(fx.context(), 1, {
      links: [{ type: 'issue', relationship: 'duplicatedBy', id: 2 }],
    });
    const { issue, paths } = await closeIssue(fx.context(), 2, {
      duplicateOf: 3,
    });
    expect(issue.links).toEqual(issueLinks({ duplicateOf: 3 }));
    // #1 stored the old link: it is rewritten in the same commit.
    expect(paths).toContain(join('.issues', '1-original.md'));
    expect((await readIssue(fx.dir, 1)).links).toBeUndefined();
    expect(fx.commits.at(-1)?.files).toEqual(paths);
  });
});

describe('other operations treat duplicateOf as a link', () => {
  beforeEach(async () => {
    await closeIssue(fx.context(), 2, { duplicateOf: 1 });
  });

  test('deleting the original clears the link', async () => {
    const result = await deleteIssue(fx.context(), 1);
    expect(result.unlinked).toMatchObject([
      { id: 2, relationships: ['duplicateOf'] },
    ]);
    const copy = await readIssue(fx.dir, 2);
    expect(copy.links).toBeUndefined();
    expect(copy.status).toBe('duplicate');
  });

  test('renumber reports it, and --update-refs repoints it', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Twin' }));
    const original = join('.issues', '1-original.md');
    const reported = await renumberIssue(fx.context({ noCommit: true }), 1, {
      file: join('.issues', '1-twin.md'),
    });
    expect(reported.references).toMatchObject([
      { id: 2, relationships: ['duplicateOf'], updated: false },
    ]);
    expect((await readIssue(fx.dir, 2)).links).toEqual(
      issueLinks({ duplicateOf: 1 }),
    );

    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Twin' }));
    const repointed = await renumberIssue(fx.context(), 1, {
      file: original,
      updateRefs: true,
    });
    expect(repointed.references).toMatchObject([
      { id: 2, relationships: ['duplicateOf'], updated: true },
      // The first renumber's comment mentions #1.
      { id: 3, relationships: [], mentions: true },
    ]);
    expect((await readIssue(fx.dir, 2)).links).toEqual(
      issueLinks({ duplicateOf: repointed.newId }),
    );
  });
});
