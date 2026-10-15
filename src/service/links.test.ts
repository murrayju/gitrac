import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitracError } from '../core/errors.ts';
import { readIssue, writeIssue } from '../fs/issue-store.ts';
import { linkIssue, unlinkIssue } from './links.ts';
import {
  makeIssue,
  type ServiceFixture,
  serviceFixture,
} from './test-helpers.fixture.ts';

/** Regression tests for #55: `gitrac link` / `unlink`. */

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

describe('linkIssue', () => {
  test('adds blockers (sorted, deduped) and a parent, and commits', async () => {
    const result = await linkIssue(fx.context(), 2, {
      blockedBy: [3, 1, 3],
      parent: 1,
    });
    expect(result.changed).toBe(true);
    expect(result.issue.blockedBy).toEqual([1, 3]);
    expect(result.paths).toEqual([join('.issues', '2-two.md')]);
    expect(fx.commits.map((c) => c.message)).toEqual(['issue: link #2 Two']);
    expect(fx.commits[0]?.operation).toBe('link');

    const onDisk = await readIssue(fx.dir, 2);
    expect(onDisk.blockedBy).toEqual([1, 3]);
    expect(onDisk.parent).toBe(1);
    expect(await fileOf('2-two.md')).toContain(
      'labels: []\nparent: 1\nblockedBy:\n  - 1\n  - 3\n',
    );
  });

  test('adding more blockers keeps the existing ones', async () => {
    await linkIssue(fx.context(), 2, { blockedBy: [1] });
    const result = await linkIssue(fx.context(), 2, { blockedBy: [3] });
    expect(result.issue.blockedBy).toEqual([1, 3]);
  });

  test('re-adding existing links is a no-op (nothing written)', async () => {
    await linkIssue(fx.context(), 2, { blockedBy: [1] });
    const before = await fileOf('2-two.md');
    const result = await linkIssue(fx.context(), 2, { blockedBy: [1] });
    expect(result.changed).toBe(false);
    expect(result.paths).toEqual([]);
    expect(fx.commits).toHaveLength(1);
    expect(await fileOf('2-two.md')).toBe(before);
  });

  test('rejects self, missing targets and cycles, writing nothing', async () => {
    await linkIssue(fx.context(), 2, { blockedBy: [1] });
    const before = await fileOf('1-one.md');

    for (const input of [
      { blockedBy: [1] },
      { blockedBy: [42] },
      { blockedBy: [2] },
      { parent: 1 },
      {},
      { blockedBy: 'x' },
    ]) {
      const err = await rejection(linkIssue(fx.context(), 1, input));
      expect(err.code).toBe('invalid_input');
    }
    expect(await fileOf('1-one.md')).toBe(before);
    expect(fx.commits).toHaveLength(1);
  });

  test('a missing issue is not_found', async () => {
    const err = await rejection(linkIssue(fx.context(), 9, { blockedBy: [1] }));
    expect(err.code).toBe('not_found');
  });

  test('links a closed issue in place', async () => {
    const result = await linkIssue(fx.context(), 3, { blockedBy: [1] });
    expect(result.paths).toEqual([join('.issues', 'closed', '3-three.md')]);
  });

  test('runs the precondition on the loaded issue', async () => {
    const err = await rejection(
      linkIssue(
        fx.context(),
        2,
        { blockedBy: [1] },
        {
          precondition: () => {
            throw new Error('stale');
          },
        },
      ),
    );
    expect(err.message).toBe('stale');
    expect((await readIssue(fx.dir, 2)).blockedBy).toBeUndefined();
  });
});

describe('unlinkIssue', () => {
  test('removes blockers and the parent; empty fields leave the file', async () => {
    await linkIssue(fx.context(), 2, { blockedBy: [1, 3], parent: 1 });
    let result = await unlinkIssue(fx.context(), 2, { blockedBy: [1] });
    expect(result.issue.blockedBy).toEqual([3]);

    result = await unlinkIssue(fx.context(), 2, {
      blockedBy: [3],
      parent: true,
    });
    expect(result.changed).toBe(true);
    expect(fx.commits.at(-1)?.message).toBe('issue: unlink #2 Two');
    const text = await fileOf('2-two.md');
    expect(text).not.toContain('blockedBy');
    expect(text).not.toContain('parent');
  });

  test('removing links that are not there is a no-op; targets may be missing', async () => {
    const result = await unlinkIssue(fx.context(), 2, { blockedBy: [99] });
    expect(result.changed).toBe(false);
    expect(fx.commits).toHaveLength(0);
  });

  test('rejects empty input', async () => {
    const err = await rejection(unlinkIssue(fx.context(), 2, {}));
    expect(err.code).toBe('invalid_input');
  });
});
