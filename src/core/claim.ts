import {
  type ClaimedElsewhere,
  claimedElsewhere,
  effectiveState,
  type IssueStateElsewhere,
  newestElsewhere,
  toClaimedElsewhere,
} from './elsewhere.ts';
import type { Issue, Status } from './types.ts';
import {
  activeStatus,
  findStatus,
  isClosedStatus,
  unclaimStatus,
  type WorkflowConfig,
} from './workflow.ts';

/**
 * Exit codes for `claim` / `unclaim`: {@link EXIT_ALREADY_CLAIMED} when the
 * issue is claimed by someone else (in the configured active status —
 * `in_progress` by default — and assigned to another user; `--force`
 * overrides), {@link EXIT_ISSUE_CLOSED} when it is closed (a closed status;
 * `claim --force` reopens and claims it). Defined with the other exit codes
 * in `errors.ts`.
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
  /**
   * Proceed: assign to the user and set the active status. `heldElsewhere`
   * is set when the effective state is already the user's own claim on
   * another branch or worktree (claiming here too is allowed, but worth a
   * warning).
   */
  | { action: 'claim'; reopen: boolean; heldElsewhere?: ClaimedElsewhere }
  /** Already active and assigned to the user: nothing to do. */
  | { action: 'noop' }
  /**
   * Refused: active and assigned to someone else — here, or (`elsewhere`)
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
 * Decide what `claim` should do with `issue` (pure; no I/O). "Active" is
 * the configured active status (`activeStatus`, default `in_progress`; see
 * `src/core/workflow.ts`).
 *
 * - Closed issues (a closed status, or living in `closed/`) are refused
 *   unless `force`, in which case they are reopened and claimed.
 * - An issue whose effective state (the newest version here or in
 *   `elsewhere`) is active and assigned to someone else is refused unless
 *   `force`.
 * - An issue that is active and already assigned to the user here, with no
 *   newer version elsewhere, is a no-op.
 * - Anything else is claimed; if the effective state is the user's own claim
 *   elsewhere, the decision says where (`heldElsewhere`).
 */
export function decideClaim(
  issue: LocalState,
  user: ClaimUser,
  config: WorkflowConfig,
  options: ClaimOptions = {},
): ClaimDecision {
  const closed =
    options.inClosedDir === true || isClosedStatus(config, issue.status);
  if (closed) {
    return options.force
      ? { action: 'claim', reopen: true }
      : { action: 'closed' };
  }
  const newer = newestElsewhere(issue, options.elsewhere);
  const effective = effectiveState(issue, options.elsewhere);
  if (effective.status === activeStatus(config)) {
    if (!newer && isAssignedTo(issue.assignee, user)) {
      return { action: 'noop' };
    }
    if (
      effective.assignee.trim() &&
      !isAssignedTo(effective.assignee, user) &&
      !options.force
    ) {
      const elsewhere = claimedElsewhere(issue, config, options.elsewhere);
      return elsewhere
        ? { action: 'already-claimed', assignee: elsewhere.assignee, elsewhere }
        : { action: 'already-claimed', assignee: effective.assignee };
    }
    const heldElsewhere = isAssignedTo(effective.assignee, user)
      ? claimedElsewhere(issue, config, options.elsewhere)
      : undefined;
    if (heldElsewhere) {
      return { action: 'claim', reopen: false, heldElsewhere };
    }
  }
  return { action: 'claim', reopen: false };
}

export type UnclaimDecision =
  /**
   * Proceed: clear the assignee and write `status` (the active status moved
   * back to the unclaim status; other statuses kept). `elsewhere` is set when
   * the claim being released is the effective version on another branch or
   * worktree: the local release (with a newer `updated`) supersedes it.
   */
  | { action: 'unclaim'; status: Status; elsewhere?: ClaimedElsewhere }
  /** Not assigned to anyone (in the effective state): nothing to do. */
  | { action: 'noop' }
  /** Refused: assigned to someone else — here, or (`elsewhere`) in a newer version elsewhere. */
  | { action: 'not-yours'; assignee: string; elsewhere?: ClaimedElsewhere }
  /**
   * Refused: the issue is closed — here, or (`elsewhere`) in a newer version
   * on another branch or worktree (releasing it would reopen it).
   */
  | { action: 'closed'; status: Status; elsewhere?: IssueStateElsewhere };

/**
 * Decide what `unclaim` should do with `issue` (pure; no I/O), judged by its
 * effective state (the newest version here or in `elsewhere`, see
 * `src/core/elsewhere.ts`), so a claim held in another worktree or on
 * another branch can be released from here.
 *
 * - Closed issues (here, or in the effective state) are always refused
 *   (reopen them first).
 * - An issue that is unassigned in its effective state is a no-op.
 * - Releasing someone else's claim requires `force`.
 * - Otherwise it is released: the assignee is cleared and the effective
 *   status is kept, except that the active status becomes the unclaim status.
 */
export function decideUnclaim(
  issue: LocalState,
  user: ClaimUser,
  config: WorkflowConfig,
  options: {
    force?: boolean;
    inClosedDir?: boolean;
    elsewhere?: readonly IssueStateElsewhere[];
  } = {},
): UnclaimDecision {
  if (options.inClosedDir === true || isClosedStatus(config, issue.status)) {
    return { action: 'closed', status: issue.status };
  }
  const newer = newestElsewhere(issue, options.elsewhere);
  if (newer && isClosedStatus(config, newer.status)) {
    return { action: 'closed', status: newer.status, elsewhere: newer };
  }
  const effective = newer ?? issue;
  const assignee = effective.assignee?.trim() ? effective.assignee : '';
  if (!assignee) {
    return { action: 'noop' };
  }
  const where = newer ? { elsewhere: toClaimedElsewhere(newer) } : {};
  if (!isAssignedTo(assignee, user) && !options.force) {
    return { action: 'not-yours', assignee, ...where };
  }
  // Keep the effective status (if this config knows it), except the active one.
  const kept =
    newer && findStatus(config, newer.status) ? newer.status : issue.status;
  const status = kept === activeStatus(config) ? unclaimStatus(config) : kept;
  return { action: 'unclaim', status, ...where };
}
