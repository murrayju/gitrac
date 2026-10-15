import { GitracError, issueNotFound } from '../core/errors.ts';
import { parseIssueFile } from '../core/issue.ts';
import type { Issue } from '../core/types.ts';
import { readIssueContent } from '../fs/issue-store.ts';
import { issuePath } from './context.ts';
import { IssueUnreadableError } from './errors.ts';

/** An issue as currently on disk: parsed, raw bytes, and where it lives. */
export interface StoredIssue {
  issue: Issue;
  /** Raw file contents (e.g. for an ETag). */
  content: string;
  filename: string;
  /** Whether the file is in `.issues/closed/`. */
  closed: boolean;
}

/**
 * Caller-supplied check run on the freshly loaded issue, under the repo lock
 * and before it is changed or written (e.g. the web API's `If-Match`). Input
 * that doesn't depend on the issue is validated before it is loaded. Throw to
 * abort the operation.
 */
export type Precondition = (current: StoredIssue) => void;

async function readStoredIssue(
  dir: string,
  id: number,
): Promise<StoredIssue | null> {
  try {
    const raw = await readIssueContent(dir, id);
    if (!raw) return null;
    const path = issuePath(raw.filename, raw.closed);
    return { issue: parseIssueFile(raw.content, { id, path }), ...raw };
  } catch (err) {
    // Several files for the ID is a conflict to resolve, and a malformed
    // file one to fix by hand: neither is merely "unreadable".
    if (
      err instanceof GitracError &&
      (err.code === 'duplicate_issue' || err.code === 'invalid_issue')
    ) {
      throw err;
    }
    throw new IssueUnreadableError(id, err);
  }
}

/**
 * Load an existing issue for a mutation (callers hold the repo lock) and run
 * `precondition` on it. Throws `not_found` if there is no file for the ID,
 * `duplicate_issue` if there are several, `invalid_issue` if the file is
 * malformed (no frontmatter, bad YAML, an id that doesn't match the file
 * name; see `parseIssueFile`), or {@link IssueUnreadableError} if it can't
 * be read.
 */
export async function loadStoredIssue(
  dir: string,
  id: number,
  precondition?: Precondition,
): Promise<StoredIssue> {
  const stored = await readStoredIssue(dir, id);
  if (!stored) throw issueNotFound(id);
  precondition?.(stored);
  return stored;
}
