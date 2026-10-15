import type { AmendTracker } from '../git/amend-tracker.ts';
import { commitIssueChange } from '../git/operations.ts';
import type { Operation } from './context.ts';

/** A commit the service layer asks for. */
export interface CommitRequest {
  /** Project root. */
  dir: string;
  operation: Operation;
  /** The issue the change is about, or null for config-only changes. */
  issueId: number | null;
  /** Repo-relative paths; only these are committed. */
  files: string[];
  message: string;
}

/**
 * Commits a change; returns the new commit hash, or null if none is known
 * (nothing to commit, or the strategy amended / dropped a commit).
 */
export type CommitStrategy = (request: CommitRequest) => Promise<string | null>;

/** A new path-limited commit per change (the CLI). */
export const commitStrategy: CommitStrategy = ({ dir, files, message }) =>
  commitIssueChange(dir, files, message);

/**
 * The web UI's amend-until-pushed strategy: a create starts a new amendable
 * commit, later changes to the same issue are folded into it while it is
 * still HEAD and unpushed (see `AmendTracker.commitOrAmend`), and config-only
 * changes are plain commits. A delete is always a new commit (folding it
 * into the issue's create commit would leave an empty commit) and ends any
 * amend chain.
 */
export function amendStrategy(tracker: AmendTracker): CommitStrategy {
  return async ({ dir, operation, issueId, files, message }) => {
    if (issueId === null) {
      return commitIssueChange(dir, files, message);
    }
    if (operation === 'delete') {
      tracker.clear();
      return commitIssueChange(dir, files, message);
    }
    if (operation === 'create') {
      const hash = await commitIssueChange(dir, files, message);
      if (hash) tracker.record(issueId, hash);
      return hash;
    }
    await tracker.commitOrAmend(dir, issueId, files, message);
    return null;
  };
}
