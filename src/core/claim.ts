import {
  type ClaimedElsewhere,
  claimedElsewhere,
  effectiveState,
  type IssueStateElsewhere,
  newestElsewhere,
} from './elsewhere.ts';
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
  /**
   * Refused: in_progress and assigned to someone else — here, or (`elsewhere`)
   * on another branch or worktree whose version is newer.
   */
  | {
      action: 'already-claimed';
      assignee: string;
      elsewhere?: ClaimedElsewhere;
    }
  /** Refused: the issue is closed. */
  | { action: 'closed' };

/** The local issue's claim-relevant fields (`updated`: to compare with `elsewhere`). */
type LocalState = Pick<Issue, 'status' | 'assignee'> &
  Partial<Pick<Issue, 'updated'>>;

export interface ClaimOptions {
  /** Take over someone else's claim; reopen a closed issue. */
  force?: boolean;
  /** Whether the file is in `closed/`. */
  inClosedDir?: boolean;
  /**
   * The issue's versions on other branches and worktrees (see
   * `src/core/elsewhere.ts`); the newest version anywhere decides whether it
   * is claimed.
   */
  elsewhere?: readonly IssueStateElsewhere[];
}

/**
 * Decide what `claim` should do with `issue` (pure; no I/O).
 *
 * - Closed issues (status `done`/`cancelled`, or living in `closed/`) are
 *   refused unless `force`, in which case they are reopened and claimed.
 * - An issue whose effective state (the newest version here or in
 *   `elsewhere`) is `in_progress` and assigned to someone else is refused
 *   unless `force`.
 * - An issue that is `in_progress` and already assigned to the user here,
 *   with no newer version elsewhere, is a no-op.
 * - Anything else is claimed.
 */
export function decideClaim(
  issue: LocalState,
  user: ClaimUser,
  options: ClaimOptions = {},
): ClaimDecision {
  const closed = options.inClosedDir === true || isClosedStatus(issue.status);
  if (closed) {
    return options.force
      ? { action: 'claim', reopen: true }
      : { action: 'closed' };
  }
  const newer = newestElsewhere(issue, options.elsewhere);
  const effective = effectiveState(issue, options.elsewhere);
  if (effective.status === 'in_progress') {
    if (!newer && isAssignedTo(issue.assignee, user)) {
      return { action: 'noop' };
    }
    if (
      effective.assignee.trim() &&
      !isAssignedTo(effective.assignee, user) &&
      !options.force
    ) {
      const elsewhere = claimedElsewhere(issue, options.elsewhere);
      return elsewhere
        ? { action: 'already-claimed', assignee: elsewhere.assignee, elsewhere }
        : { action: 'already-claimed', assignee: effective.assignee };
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
