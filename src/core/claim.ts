import {
  type ClaimedElsewhere,
  type ClosedElsewhere,
  claimedElsewhere,
  closedElsewhere,
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
  isHeldStatus,
  reviewStatus,
  unclaimStatus,
  type WorkflowConfig,
} from './workflow.ts';

/**
 * Exit codes for `claim` / `unclaim`: {@link EXIT_ALREADY_CLAIMED} when the
 * issue is claimed by someone else (in a held status, see `heldStatuses` in
 * `src/core/workflow.ts`, and assigned to another user; `--force`
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
  /**
   * Already active and assigned to the user: nothing to do. (An issue of
   * theirs in the review status is claimed: back to the active status.)
   */
  | { action: 'noop' }
  /**
   * Refused: held (active or in review) and assigned to someone else: here,
   * or (`elsewhere`) on another branch or worktree whose version is newer.
   */
  | {
      action: 'already-claimed';
      assignee: string;
      elsewhere?: ClaimedElsewhere;
    }
  /**
   * Refused: the issue is closed here, or (`elsewhere`) in a newer version
   * on another branch or worktree.
   */
  | { action: 'closed'; elsewhere?: ClosedElsewhere };

/** The local issue's claim-relevant fields (`updated`: to compare with `elsewhere`). */
type LocalState = Pick<Issue, 'status' | 'assignee'> &
  Partial<Pick<Issue, 'updated'>>;

export interface ClaimOptions {
  /** Take over someone else's claim; reopen a closed issue. */
  force?: boolean;
  /**
   * The issue's versions on other branches and worktrees (see
   * `src/core/elsewhere.ts`); the newest version anywhere decides whether it
   * is claimed.
   */
  elsewhere?: readonly IssueStateElsewhere[];
}

/**
 * Decide what `claim` should do with `issue` (pure; no I/O). "Active" is
 * the configured active status (`activeStatus`, default `in_progress`);
 * "held" is the active status or the review status (`heldStatuses`; see
 * `src/core/workflow.ts`).
 *
 * - Closed issues (a closed status; the directory does not count, see #97)
 *   are refused unless `force`, in which case they are reopened and claimed.
 * - An open issue whose effective state is closed elsewhere (e.g. closed in
 *   an agent's worktree, not merged yet) is refused unless `force`, in which
 *   case it is claimed here (this newer version then supersedes the close).
 * - An issue whose effective state (the newest version here or in
 *   `elsewhere`) is held and assigned to someone else is refused unless
 *   `force`.
 * - An issue that is active and already assigned to the user here, with no
 *   newer version elsewhere, is a no-op. If it is in review instead, it is
 *   claimed (moved back to the active status for rework).
 * - Anything else is claimed; if the effective state is the user's own claim
 *   elsewhere, the decision says where (`heldElsewhere`).
 */
export function decideClaim(
  issue: LocalState,
  user: ClaimUser,
  config: WorkflowConfig,
  options: ClaimOptions = {},
): ClaimDecision {
  if (isClosedStatus(config, issue.status)) {
    return options.force
      ? { action: 'claim', reopen: true }
      : { action: 'closed' };
  }
  const closedThere = closedElsewhere(issue, config, options.elsewhere);
  if (closedThere && !options.force) {
    return { action: 'closed', elsewhere: closedThere };
  }
  const newer = newestElsewhere(issue, options.elsewhere);
  const effective = effectiveState(issue, options.elsewhere);
  if (isHeldStatus(config, effective.status)) {
    if (
      !newer &&
      issue.status === activeStatus(config) &&
      isAssignedTo(issue.assignee, user)
    ) {
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

export type EditDecision =
  /** Proceed: write the edit. */
  | { action: 'edit' }
  /**
   * Refused: the edit changes the status or the assignee, and the issue is
   * held (active or in review) by someone else: here, or (`elsewhere`) on
   * another branch or worktree whose version is newer.
   */
  | {
      action: 'already-claimed';
      assignee: string;
      elsewhere?: ClaimedElsewhere;
    };

/**
 * Decide if an edit (`gitrac edit`, `PATCH /api/issues/:id`) can write
 * (pure; no I/O). `changesClaim` tells if the edit changes the status or
 * the assignee of the local issue (a no-op field does not count).
 *
 * - An edit that changes neither field is always allowed (title, priority,
 *   labels, description).
 * - An edit that changes one of them is refused if the effective state of
 *   the issue (the newest version here or in `elsewhere`) is held (see
 *   `heldStatuses` in `src/core/workflow.ts`) and assigned to someone other
 *   than `user`, unless `force`. Thus the edit can not silently overwrite a
 *   claim. The claim holder can always edit.
 */
export function decideEdit(
  issue: LocalState,
  changesClaim: boolean,
  user: ClaimUser,
  config: WorkflowConfig,
  options: ClaimOptions = {},
): EditDecision {
  if (!changesClaim || options.force) return { action: 'edit' };
  const effective = effectiveState(issue, options.elsewhere);
  const assignee = effective.assignee.trim();
  if (
    !isHeldStatus(config, effective.status) ||
    !assignee ||
    isAssignedTo(assignee, user)
  ) {
    return { action: 'edit' };
  }
  const elsewhere = claimedElsewhere(issue, config, options.elsewhere);
  return elsewhere
    ? { action: 'already-claimed', assignee: elsewhere.assignee, elsewhere }
    : { action: 'already-claimed', assignee: effective.assignee };
}

export type UnclaimDecision =
  /**
   * Proceed: clear the assignee and write `status` (a held status moved
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
 *   status is kept, except that a held status (active or review) becomes the
 *   unclaim status.
 */
export function decideUnclaim(
  issue: LocalState,
  user: ClaimUser,
  config: WorkflowConfig,
  options: {
    force?: boolean;
    elsewhere?: readonly IssueStateElsewhere[];
  } = {},
): UnclaimDecision {
  if (isClosedStatus(config, issue.status)) {
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
  // Keep the effective status (if this config knows it), except a held one.
  const kept =
    newer && findStatus(config, newer.status) ? newer.status : issue.status;
  const status = isHeldStatus(config, kept) ? unclaimStatus(config) : kept;
  return { action: 'unclaim', status, ...where };
}

export type ReviewDecision =
  /**
   * Proceed: set `status` (the review status) and keep `assignee` (the
   * effective one).
   * `elsewhere` is set when the claim being handed off is the effective
   * version on another branch or worktree: the local write (with a newer
   * `updated`) supersedes it.
   */
  | {
      action: 'review';
      status: Status;
      assignee: string;
      elsewhere?: ClaimedElsewhere;
    }
  /** Already in the review status: nothing to do. */
  | { action: 'noop' }
  /** Refused: no review status is configured. */
  | { action: 'no-review-status' }
  /** Refused: not claimed (not in the active status, or unassigned). */
  | { action: 'not-claimed'; status: Status }
  /** Refused: claimed by someone else, here or (`elsewhere`) in a newer version elsewhere. */
  | { action: 'not-yours'; assignee: string; elsewhere?: ClaimedElsewhere }
  /** Refused: closed here, or (`elsewhere`) in a newer version elsewhere. */
  | { action: 'closed'; status: Status; elsewhere?: ClosedElsewhere };

/**
 * Decide what `review` should do with `issue` (pure; no I/O): hand off a
 * claimed issue for review. Judged by the effective state (the newest
 * version here or in `elsewhere`), like `unclaim`.
 *
 * - Without a configured review status (`reviewStatus`), it is refused.
 * - Closed issues (here, or in the effective state) are refused.
 * - An issue that is not held (not in the active or review status, or
 *   unassigned) is refused: claim it first.
 * - Someone else's claim needs `force`; their assignee is then kept.
 * - An issue already in the review status is a no-op.
 * - Otherwise it moves to the review status. The assignee is kept, so the
 *   issue stays held (see `heldStatuses` in `src/core/workflow.ts`).
 */
export function decideReview(
  issue: LocalState,
  user: ClaimUser,
  config: WorkflowConfig,
  options: ClaimOptions = {},
): ReviewDecision {
  const review = reviewStatus(config);
  if (review === undefined) return { action: 'no-review-status' };
  if (isClosedStatus(config, issue.status)) {
    return { action: 'closed', status: issue.status };
  }
  const closedThere = closedElsewhere(issue, config, options.elsewhere);
  if (closedThere) {
    return {
      action: 'closed',
      status: closedThere.status,
      elsewhere: closedThere,
    };
  }
  const newer = newestElsewhere(issue, options.elsewhere);
  const effective = newer ?? issue;
  const assignee = effective.assignee?.trim() ? effective.assignee : '';
  if (!assignee || !isHeldStatus(config, effective.status)) {
    return { action: 'not-claimed', status: effective.status };
  }
  const where = newer ? { elsewhere: toClaimedElsewhere(newer) } : {};
  if (!isAssignedTo(assignee, user) && !options.force) {
    return { action: 'not-yours', assignee, ...where };
  }
  if (effective.status === review) return { action: 'noop' };
  return { action: 'review', status: review, assignee, ...where };
}
