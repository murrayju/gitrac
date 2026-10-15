import { issueNotFound } from '../core/errors.ts';
import { parseIssue } from '../core/issue.ts';
import type { Issue } from '../core/types.ts';
import { readIssueContent } from '../fs/issue-store.ts';
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
 * and before anything else is validated or written (e.g. the web API's
 * `If-Match`). Throw to abort the operation.
 */
export type Precondition = (current: StoredIssue) => void;

async function readStoredIssue(
  dir: string,
  id: number,
): Promise<StoredIssue | null> {
  try {
    const raw = await readIssueContent(dir, id);
    return raw && { issue: parseIssue(raw.content), ...raw };
  } catch (err) {
    throw new IssueUnreadableError(id, err);
  }
}

/**
 * Load an existing issue for a mutation (callers hold the repo lock) and run
 * `precondition` on it. Throws `not_found` if there is no file for the ID, or
 * {@link IssueUnreadableError} if it can't be read or parsed.
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
