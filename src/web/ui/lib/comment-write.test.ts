import { describe, expect, mock, test } from 'bun:test';
import type { Comment } from '../../../core/types.ts';
import { ApiError, type ApiIssue, ConflictError } from '../api.ts';
import { commentKeys, guardedCommentWrite } from './comment-write.ts';

const comment = (author: string, timestamp: string): Comment => ({
  author,
  timestamp,
  body: 'text',
});

describe('commentKeys', () => {
  test('comments with the same author and timestamp get different keys', () => {
    const keys = commentKeys([
      comment('ann', '2026-01-01T00:00:00Z'),
      comment('ann', '2026-01-01T00:00:00Z'),
      comment('bob', '2026-01-01T00:00:00Z'),
    ]);
    expect(new Set(keys).size).toBe(3);
  });

  test('a key stays the same when a comment above it is removed', () => {
    const a = comment('ann', '2026-01-01T00:00:00Z');
    const b = comment('bob', '2026-01-02T00:00:00Z');
    const c = comment('cid', '2026-01-03T00:00:00Z');
    const before = commentKeys([a, b, c]);
    const after = commentKeys([a, c]);
    expect(after[1]).toBe(before[2] as string);
  });
});

describe('guardedCommentWrite', () => {
  const latest = { id: 7, title: 'Latest' } as ApiIssue;

  test('returns true when the write succeeds', async () => {
    const onConflict = mock(() => {});
    const notify = mock(() => {});
    expect(
      await guardedCommentWrite(async () => ({}), onConflict, notify),
    ).toBe(true);
    expect(onConflict).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  test('a 409 shows the latest issue and its version, then notifies', async () => {
    const calls: string[] = [];
    const ok = await guardedCommentWrite(
      async () => {
        throw new ConflictError('{}', latest, '"v2"');
      },
      (current, version) => {
        calls.push(`apply ${current.title} ${version}`);
      },
      () => calls.push('notify'),
    );
    expect(ok).toBe(false);
    expect(calls).toEqual(['apply Latest "v2"', 'notify']);
  });

  test('other errors go to the caller', async () => {
    const onConflict = mock(() => {});
    const err = new ApiError(500, 'disk full');
    await expect(
      guardedCommentWrite(
        async () => {
          throw err;
        },
        onConflict,
        () => {},
      ),
    ).rejects.toBe(err);
    expect(onConflict).not.toHaveBeenCalled();
  });
});
