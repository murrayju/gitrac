import type { Comment } from '../../../core/types.ts';
import { type ApiIssue, ConflictError } from '../api.ts';

/**
 * React keys for a comment list. A key is the author and timestamp plus the
 * number of earlier comments with the same author and timestamp, so two
 * such comments never collide. The key does not contain the list index:
 * when a comment above is removed, the key of each comment stays the same,
 * and an open inline editor keeps its draft.
 */
export function commentKeys(comments: readonly Comment[]): string[] {
  const seen = new Map<string, number>();
  return comments.map((c) => {
    const base = `${c.author}-${c.timestamp}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}-${n}`;
  });
}

/**
 * Run a comment edit or delete that is guarded by an issue version. On a
 * 409, give the latest issue to `onConflict` (so the view shows it), call
 * `notify`, and return `false`. Other errors go to the caller.
 */
export async function guardedCommentWrite(
  write: () => Promise<unknown>,
  onConflict: (current: ApiIssue, version: string | null) => void,
  notify: () => void,
): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    onConflict(e.current, e.version);
    notify();
    return false;
  }
}
