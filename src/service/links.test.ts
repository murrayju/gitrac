import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitracError } from '../core/errors.ts';
import { issueLinks } from '../core/links.fixture.ts';
import type { IssueRelationship, Link } from '../core/links.ts';
import { readIssue, writeIssue } from '../fs/issue-store.ts';
import { linkIssue, unlinkIssue } from './links.ts';
import {
  makeIssue,
  type ServiceFixture,
  serviceFixture,
} from './test-helpers.fixture.ts';

/** Regression tests for #55 / #127: `gitrac link` / `unlink`. */

let fx: ServiceFixture;

beforeEach(async () => {
  fx = await serviceFixture();
  await writeIssue(fx.dir, makeIssue({ id: 1, title: 'One' }));
  await writeIssue(fx.dir, makeIssue({ id: 2, title: 'Two' }));
  await writeIssue(
    fx.dir,
    makeIssue({ id: 3, title: 'Three', status: 'done' }),
    { closed: true },
  );
});

afterEach(async () => {
  await fx.cleanup();
});

async function rejection(promise: Promise<unknown>): Promise<GitracError> {
  try {
    await promise;
  } catch (err) {
    return err as GitracError;
  }
  throw new Error('expected the operation to fail');
}

const fileOf = (name: string) =>
  readFile(join(fx.dir, '.issues', name), 'utf-8');

const issue = (relationship: IssueRelationship, id?: number) =>
  ({ type: 'issue', relationship, id }) as Link;

/** `linkIssue` with `{ links }`. */
const link = (id: number, ...links: unknown[]) =>
  linkIssue(fx.context(), id, { links });
const unlink = (id: number, ...links: unknown[]) =>
  unlinkIssue(fx.context(), id, { links });

describe('linkIssue', () => {
  test('adds links in order (without duplicates) and commits', async () => {
    const result = await link(
      2,
      issue('blockedBy', 3),
      issue('blockedBy', 1),
      issue('blockedBy', 3),
      issue('parent', 1),
      { type: 'url', url: 'https://x.dev' },
    );
    expect(result.changed).toBe(true);
    expect(result.issue.links).toEqual([
      ...issueLinks({ blockedBy: [3, 1], parent: 1 }),
      { type: 'url', url: 'https://x.dev' },
    ]);
    expect(result.paths).toEqual([join('.issues', '2-two.md')]);
    expect(fx.commits.map((c) => c.message)).toEqual(['issue: link #2 Two']);
    expect(fx.commits[0]?.operation).toBe('link');
    expect((await readIssue(fx.dir, 2)).links).toEqual(result.issue.links);
    expect(await fileOf('2-two.md')).toContain(
      'labels: []\nlinks:\n  - type: issue\n    relationship: blockedBy\n    id: 3\n',
    );
  });

  test('a link is written on its home: the blocked issue, the sub-issue, the duplicate, the higher ID', async () => {
    const result = await link(
      1,
      issue('blocks', 2),
      issue('child', 2),
      issue('duplicatedBy', 2),
      issue('related', 2),
    );
    expect(result.changed).toBe(true);
    expect(result.paths).toEqual([join('.issues', '2-two.md')]);
    expect(fx.commits.map((c) => c.message)).toEqual(['issue: link #1 One']);
    expect((await readIssue(fx.dir, 1)).links).toBeUndefined();
    const two = await readIssue(fx.dir, 2);
    expect(two.links).toEqual(
      issueLinks({ blockedBy: 1, parent: 1, duplicateOf: 1, related: 1 }),
    );
    // Not activity on #2: its `updated` (claims, staleness) stays.
    expect(two.updated).toBe('2025-01-01T00:00:00Z');
    // From #2 itself, the same links are no-ops.
    const again = await link(2, issue('blockedBy', 1), issue('related', 1));
    expect(again.changed).toBe(false);
  });

  test('a link that exists on the other issue is a no-op (nothing written)', async () => {
    await link(1, issue('blocks', 2));
    const before = await fileOf('2-two.md');
    const result = await link(2, issue('blockedBy', 1));
    expect(result.changed).toBe(false);
    expect(result.paths).toEqual([]);
    expect(fx.commits).toHaveLength(1);
    expect(await fileOf('2-two.md')).toBe(before);
  });

  test('a new parent replaces the old one, also when the old parent stores it', async () => {
    // #1 stores "#2 is my sub-issue" (e.g. by hand).
    await writeIssue(
      fx.dir,
      makeIssue({ id: 1, title: 'One', links: issueLinks({ child: 2 }) }),
    );
    const result = await link(2, issue('parent', 3));
    expect(result.issue.links).toEqual(issueLinks({ parent: 3 }));
    expect(result.paths).toEqual([
      join('.issues', '2-two.md'),
      join('.issues', '1-one.md'),
    ]);
    expect((await readIssue(fx.dir, 1)).links).toBeUndefined();
  });

  test('a new original (duplicateOf) replaces the old one', async () => {
    await link(2, issue('duplicateOf', 1));
    const result = await link(2, issue('duplicateOf', 3));
    expect(result.issue.links).toEqual(issueLinks({ duplicateOf: 3 }));
  });

  test('rejects bad links, self, missing targets and cycles, writing nothing', async () => {
    await link(2, issue('blockedBy', 1));
    const before = await fileOf('1-one.md');

    for (const links of [
      [issue('blockedBy', 1)],
      [issue('blockedBy', 42)],
      [issue('blockedBy', 2)],
      [issue('blocks', 3), issue('related', 9)],
      [],
      [{ type: 'url', url: 'not a url' }],
      'x',
    ]) {
      const err = await rejection(
        linkIssue(fx.context(), 1, { links } as unknown),
      );
      expect(err.code).toBe('invalid_input');
    }
    expect(await fileOf('1-one.md')).toBe(before);
    expect(fx.commits).toHaveLength(1);
  });

  test('a missing issue is not_found', async () => {
    const err = await rejection(link(9, issue('blockedBy', 1)));
    expect(err.code).toBe('not_found');
  });

  test('links a closed issue in place', async () => {
    const result = await link(3, issue('related', 1));
    expect(result.paths).toEqual([join('.issues', 'closed', '3-three.md')]);
  });

  test('runs the precondition on the loaded issue', async () => {
    const err = await rejection(
      linkIssue(
        fx.context(),
        2,
        { links: [issue('blockedBy', 1)] },
        {
          precondition: () => {
            throw new Error('stale');
          },
        },
      ),
    );
    expect(err.message).toBe('stale');
    expect((await readIssue(fx.dir, 2)).links).toBeUndefined();
  });
});

describe('unlinkIssue', () => {
  test('removes links; no links left removes the field', async () => {
    await link(
      2,
      issue('blockedBy', 1),
      issue('blockedBy', 3),
      issue('parent', 1),
      { type: 'url', url: 'https://x.dev', title: 'X' },
    );
    let result = await unlink(2, issue('blockedBy', 1));
    expect(result.issue.links).toHaveLength(3);

    result = await unlink(2, issue('blockedBy', 3), issue('parent'), {
      type: 'url',
      url: 'https://x.dev',
    });
    expect(result.changed).toBe(true);
    expect(fx.commits.at(-1)?.message).toBe('issue: unlink #2 Two');
    expect(await fileOf('2-two.md')).not.toContain('links');
  });

  test('removes a link the other issue stores, from that file', async () => {
    await link(2, issue('blocks', 1));
    expect((await readIssue(fx.dir, 1)).links).toEqual(
      issueLinks({ blockedBy: 2 }),
    );
    const removed = await unlink(2, issue('blocks', 1));
    expect(removed.paths).toEqual([join('.issues', '1-one.md')]);
    // Stored on the other side by hand: removed there too.
    await writeIssue(
      fx.dir,
      makeIssue({ id: 1, title: 'One', links: issueLinks({ blocks: 2 }) }),
    );
    const result = await unlink(2, issue('blockedBy', 1));
    expect(result.changed).toBe(true);
    expect(result.paths).toEqual([join('.issues', '1-one.md')]);
    expect((await readIssue(fx.dir, 1)).links).toBeUndefined();
  });

  test('removing links that are not there is a no-op; targets may be missing', async () => {
    const result = await unlink(2, issue('blockedBy', 99));
    expect(result.changed).toBe(false);
    expect(fx.commits).toHaveLength(0);
  });

  test('rejects empty input', async () => {
    const err = await rejection(unlinkIssue(fx.context(), 2, { links: [] }));
    expect(err.code).toBe('invalid_input');
  });
});
