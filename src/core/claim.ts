import type { Issue } from './types.ts';
import { isClosedStatus } from './types.ts';

/**
 * Exit codes for `claim` / `unclaim`: {@link EXIT_ALREADY_CLAIMED} when the
 * issue is claimed by someone else (in_progress + assigned to another user;
 * `--force` overrides), {@link EXIT_ISSUE_CLOSED} when it is closed (`done` or
 * `cancelled`; `claim --force` reopens and claims it). Defined with the other
 * exit codes in `errors.ts`.
 */
export { EXIT_ALREADY_CLAIMED, EXIT_ISSUE_CLOSED } from './errors.ts';

/** The identity of the user running a command (as used for `assignee`). */
export interface ClaimUser {
  /** Display name (from `--author` or `git config user.name`). */
  name: string;
  /** Email (from `git config user.email`), or '' if unknown. */
  email: string;
}

/** The value written to `assignee` when `user` claims an issue. */
export function claimAssignee(user: ClaimUser): string {
  return user.email || user.name;
}

/**
 * Whether `assignee` refers to `user`, comparing case-insensitively against
 * both the user's email and name (the assignee is the claimer's email when
 * known, else their name).
 */
export function isAssignedTo(
  assignee: string | undefined,
  user: ClaimUser,
): boolean {
  const a = assignee?.trim().toLowerCase();
  if (!a) {
    return false;
  }
  return [user.email, user.name].some(
    (v) => v.trim() !== '' && v.trim().toLowerCase() === a,
  );
}

export type ClaimDecision =
  /** Proceed: assign to the user and set in_progress. */
  | { action: 'claim'; reopen: boolean }
  /** Already in_progress and assigned to the user: nothing to do. */
  | { action: 'noop' }
  /** Refused: in_progress and assigned to someone else. */
  | { action: 'already-claimed'; assignee: string }
  /** Refused: the issue is closed. */
  | { action: 'closed' };

/**
 * Decide what `claim` should do with `issue` (pure; no I/O).
 *
 * - Closed issues (status `done`/`cancelled`, or living in `closed/`) are
 *   refused unless `force`, in which case they are reopened and claimed.
 * - An issue that is `in_progress` and assigned to someone else is refused
 *   unless `force`.
 * - An issue that is `in_progress` and already assigned to the user is a
 *   no-op.
 * - Anything else is claimed.
 */
export function decideClaim(
  issue: Pick<Issue, 'status' | 'assignee'>,
  user: ClaimUser,
  options: { force?: boolean; inClosedDir?: boolean } = {},
): ClaimDecision {
  const closed = options.inClosedDir === true || isClosedStatus(issue.status);
  if (closed) {
    return options.force
      ? { action: 'claim', reopen: true }
      : { action: 'closed' };
  }
  if (issue.status === 'in_progress') {
    if (isAssignedTo(issue.assignee, user)) {
      return { action: 'noop' };
    }
    if (issue.assignee?.trim() && !options.force) {
      return { action: 'already-claimed', assignee: issue.assignee };
    }
  }
  return { action: 'claim', reopen: false };
}

export type UnclaimDecision =
  /** Proceed: clear the assignee (and move in_progress back to todo). */
  | { action: 'unclaim' }
  /** Not assigned to anyone: nothing to do. */
  | { action: 'noop' }
  /** Refused: assigned to someone else. */
  | { action: 'not-yours'; assignee: string }
  /** Refused: the issue is closed. */
  | { action: 'closed' };

/**
 * Decide what `unclaim` should do with `issue` (pure; no I/O).
 *
 * Releasing someone else's issue requires `force`. Closed issues are always
 * refused (reopen them first).
 */
export function decideUnclaim(
  issue: Pick<Issue, 'status' | 'assignee'>,
  user: ClaimUser,
  options: { force?: boolean; inClosedDir?: boolean } = {},
): UnclaimDecision {
  if (options.inClosedDir === true || isClosedStatus(issue.status)) {
    return { action: 'closed' };
  }
  if (!issue.assignee?.trim()) {
    return { action: 'noop' };
  }
  if (!isAssignedTo(issue.assignee, user) && !options.force) {
    return { action: 'not-yours', assignee: issue.assignee };
  }
  return { action: 'unclaim' };
}
