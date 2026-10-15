import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitracError } from '../core/errors.ts';
import { serializeIssue } from '../core/issue.ts';
import { findIssueFiles, readIssue, writeIssue } from '../fs/issue-store.ts';
import { renumberCandidates, renumberIssue } from './renumber.ts';
import {
  makeIssue,
  type ServiceFixture,
  serviceFixture,
} from './test-helpers.fixture.ts';

/** Regression tests for #69: renumbering a duplicate issue ID. */

let fx: ServiceFixture;

beforeEach(async () => {
  fx = await serviceFixture();
  // Two clones both created #1; #2 is unrelated.
  await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Alpha' }));
  await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Beta' }));
  await writeIssue(fx.dir, makeIssue({ id: 2, title: 'Other' }));
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

const ALPHA = join('.issues', '1-alpha.md');
const BETA = join('.issues', '1-beta.md');

describe('renumberCandidates', () => {
  test('lists every file of the ID with its title', async () => {
    expect(await renumberCandidates(fx.dir, 1)).toEqual([
      { path: ALPHA, filename: '1-alpha.md', closed: false, title: 'Alpha' },
      { path: BETA, filename: '1-beta.md', closed: false, title: 'Beta' },
    ]);
  });
});

describe('renumberIssue', () => {
  test('without a file, a duplicated ID is duplicate_issue listing the candidates', async () => {
    const before = await snapshot();
    const err = await rejection(renumberIssue(fx.context(), 1));
    expect(err.code).toBe('duplicate_issue');
    expect(err.message).toContain(`${ALPHA} ("Alpha")`);
    expect(err.message).toContain(`${BETA} ("Beta")`);
    expect(err.details).toMatchObject({
      id: 1,
      files: [ALPHA, BETA],
      candidates: [{ path: ALPHA }, { path: BETA }],
    });
    expect(await snapshot()).toEqual(before);
    expect(fx.commits).toEqual([]);
  });

  test('moves the chosen file to a fresh ID and commits it', async () => {
    const result = await renumberIssue(fx.context(), 1, { file: BETA });

    expect(result.oldId).toBe(1);
    expect(result.newId).toBe(3);
    expect(result.from).toBe(BETA);
    expect(result.to).toBe(join('.issues', '3-beta.md'));
    expect(result.commit).toBe('abc123');
    expect(result.references).toEqual([]);

    const moved = await readIssue(fx.dir, 3);
    expect(moved.title).toBe('Beta');
    expect(moved.updated).not.toBe('2025-01-01T00:00:00Z');
    // The other copy keeps the ID, untouched; #1 is no longer duplicated.
    expect((await readIssue(fx.dir, 1)).title).toBe('Alpha');
    expect(await findIssueFiles(fx.dir, 1)).toHaveLength(1);

    expect(fx.events).toEqual(['written:renumber', 'commit:renumber']);
    expect(fx.commits[0]).toMatchObject({
      operation: 'renumber',
      issueId: 3,
      files: [join('.issues', '3-beta.md'), BETA],
      message: 'issue: renumber #1 -> #3 Beta',
    });
  });

  test('accepts a bare filename', async () => {
    const result = await renumberIssue(fx.context(), 1, {
      file: '1-alpha.md',
    });
    expect(result.from).toBe(ALPHA);
    expect((await readIssue(fx.dir, 1)).title).toBe('Beta');
  });

  test('a file that is not one of the ID is invalid_input', async () => {
    const before = await snapshot();
    const err = await rejection(
      renumberIssue(fx.context(), 1, { file: '.issues/2-other.md' }),
    );
    expect(err.code).toBe('invalid_input');
    expect(err.details).toMatchObject({ files: [ALPHA, BETA] });
    expect(await snapshot()).toEqual(before);
  });

  test('a filename in both .issues/ and closed/ needs the path', async () => {
    await writeIssue(
      fx.dir,
      makeIssue({ id: 1, title: 'Alpha', status: 'done' }),
      { closed: true },
    );
    const err = await rejection(
      renumberIssue(fx.context(), 1, { file: '1-alpha.md' }),
    );
    expect(err.code).toBe('invalid_input');
    const result = await renumberIssue(fx.context(), 1, {
      file: join('.issues', 'closed', '1-alpha.md'),
    });
    // A closed copy stays in closed/.
    expect(result.to).toBe(join('.issues', 'closed', '3-alpha.md'));
  });

  test('a non-duplicated ID needs force', async () => {
    const before = await snapshot();
    const err = await rejection(renumberIssue(fx.context(), 2));
    expect(err.code).toBe('invalid_state');
    expect(err.message).toContain('not duplicated');
    expect(await snapshot()).toEqual(before);

    const result = await renumberIssue(fx.context(), 2, { force: true });
    expect(result.newId).toBe(3);
    expect(await findIssueFiles(fx.dir, 2)).toEqual([]);
  });

  test('a missing ID is not_found', async () => {
    const err = await rejection(renumberIssue(fx.context(), 9));
    expect(err.code).toBe('not_found');
  });

  test('a malformed chosen file is invalid_issue and nothing changes', async () => {
    await writeFile(join(fx.dir, BETA), 'no frontmatter\n');
    const before = await snapshot();
    const err = await rejection(renumberIssue(fx.context(), 1, { file: BETA }));
    expect(err.code).toBe('invalid_issue');
    expect(await snapshot()).toEqual(before);
  });

  test('respects noCommit', async () => {
    const result = await renumberIssue(fx.context({ noCommit: true }), 1, {
      file: BETA,
    });
    expect(result.commit).toBeNull();
    expect(fx.commits).toEqual([]);
    expect(await findIssueFiles(fx.dir, 3)).toHaveLength(1);
  });

  describe('references to the old ID', () => {
    beforeEach(async () => {
      await writeIssue(
        fx.dir,
        makeIssue({ id: 2, title: 'Other', blockedBy: [1] }),
      );
      await mkdir(join(fx.dir, '.issues', 'closed'), { recursive: true });
      await writeIssue(
        fx.dir,
        makeIssue({
          id: 4,
          title: 'Child',
          status: 'done',
          parent: 1,
          description: 'Part of #1.',
        }),
        { closed: true },
      );
      await writeIssue(
        fx.dir,
        makeIssue({
          id: 5,
          title: 'Mention',
          description: 'See #1, not #10 or &#1;.',
        }),
      );
      await writeIssue(
        fx.dir,
        makeIssue({ id: 6, title: 'Unrelated', description: 'See #10.' }),
      );
    });

    test('are reported but not rewritten by default', async () => {
      const before = await Promise.all(
        [2, 4, 5].map((id) => readIssue(fx.dir, id)),
      );
      const result = await renumberIssue(fx.context(), 1, { file: BETA });
      expect(result.newId).toBe(7);
      expect(result.references).toEqual([
        {
          id: 2,
          title: 'Other',
          blockedBy: true,
          parent: false,
          mentions: false,
          updated: false,
          paths: [],
        },
        {
          id: 4,
          title: 'Child',
          blockedBy: false,
          parent: true,
          mentions: true,
          updated: false,
          paths: [],
        },
        {
          id: 5,
          title: 'Mention',
          blockedBy: false,
          parent: false,
          mentions: true,
          updated: false,
          paths: [],
        },
      ]);
      expect(
        await Promise.all([2, 4, 5].map((id) => readIssue(fx.dir, id))),
      ).toEqual(before);
      expect(fx.commits[0]?.files).toEqual([
        join('.issues', '7-beta.md'),
        BETA,
      ]);
    });

    test('updateRefs rewrites blockedBy/parent links (not mentions) in the same commit', async () => {
      const result = await renumberIssue(fx.context(), 1, {
        file: BETA,
        updateRefs: true,
      });
      expect(result.references.map((r) => [r.id, r.updated, r.paths])).toEqual([
        [2, true, [join('.issues', '2-other.md')]],
        [4, true, [join('.issues', 'closed', '4-child.md')]],
        [5, false, []],
      ]);
      const other = await readIssue(fx.dir, 2);
      expect(other.blockedBy).toEqual([7]);
      expect(other.updated).not.toBe('2025-01-01T00:00:00Z');
      const child = await readIssue(fx.dir, 4);
      expect(child.parent).toBe(7);
      expect(child.description).toBe('Part of #1.');
      expect((await readIssue(fx.dir, 5)).description).toContain('See #1,');
      expect(fx.commits).toHaveLength(1);
      expect(fx.commits[0]?.files).toEqual([
        join('.issues', '7-beta.md'),
        BETA,
        join('.issues', '2-other.md'),
        join('.issues', 'closed', '4-child.md'),
      ]);
    });

    test('updateRefs fails before writing if a linking issue is duplicated', async () => {
      await writeFile(
        join(fx.dir, '.issues', '2-copy.md'),
        serializeIssue(makeIssue({ id: 2, title: 'Copy', blockedBy: [1] })),
      );
      const before = await snapshot();
      const err = await rejection(
        renumberIssue(fx.context(), 1, { file: BETA, updateRefs: true }),
      );
      expect(err.code).toBe('duplicate_issue');
      expect(err.details).toMatchObject({ id: 2 });
      expect(await snapshot()).toEqual(before);
      expect(fx.commits).toEqual([]);
    });
  });
});
