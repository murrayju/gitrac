import type { Issue, Status } from './types.ts';
import {
  isClosedStatus,
  isHeldStatus,
  type WorkflowConfig,
} from './workflow.ts';

/**
 * Issue state on other branches and worktrees (pure; no I/O).
 *
 * Each worktree has its own checkout of `.issues/`, so a claim made in one
 * worktree (or committed on a branch that isn't merged yet) isn't in this
 * working tree. `src/git/elsewhere.ts` gathers the versions of an issue on
 * every local and remote-tracking branch and in every other worktree's
 * working tree; the *effective* state of the issue is the newest of those
 * and the local one, by `updated`. So a claim anywhere is seen everywhere,
 * and a later unclaim or close anywhere supersedes it.
 */

/** The version of an issue found on another branch or worktree. */
export interface IssueStateElsewhere {
  /**
   * Short branch name (`feature`, or `origin/feature` for a remote-tracking
   * branch); `HEAD` for a worktree with a detached HEAD.
   */
  ref: string;
  /** Set when read from another worktree's working tree (maybe uncommitted). */
  worktree?: string;
  status: Status;
  assignee: string;
  updated: string;
  /**
   * The full parsed issue of this version; only set when the scan was asked
   * for it (`withIssues`), e.g. to show issues that are only elsewhere.
   */
  issue?: Issue;
}

/**
 * Where an issue was found when this working tree has no file for it (e.g.
 * an agent created it in its worktree or on its branch, not merged yet).
 */
export interface FoundElsewhere {
  ref: string;
  worktree?: string;
}

/** An issue that exists only elsewhere: its newest version and where. */
export interface IssueOnlyElsewhere {
  issue: Issue;
  foundElsewhere: FoundElsewhere;
}

/** Where (and by whom) an issue is claimed, when that's not this working tree. */
export interface ClaimedElsewhere {
  ref: string;
  worktree?: string;
  assignee: string;
  updated: string;
}

/**
 * Where (and in which closed status) an issue is closed, when that is not
 * this working tree: the close is newer than the local version, so it is the
 * effective state (e.g. work done in an agent's worktree, not merged yet).
 */
export interface ClosedElsewhere {
  ref: string;
  worktree?: string;
  status: Status;
  updated: string;
}

/**
 * Marks for an issue whose effective state is on another branch or in
 * another worktree. At most one of `claimedElsewhere` and `closedElsewhere`
 * is set: the newest version is either a claim or a close.
 * `foundElsewhere` is set alone, on an issue that has no file in this
 * working tree (see {@link issuesOnlyElsewhere}).
 */
export interface ElsewhereMarks {
  claimedElsewhere?: ClaimedElsewhere;
  closedElsewhere?: ClosedElsewhere;
  foundElsewhere?: FoundElsewhere;
}

/** Whether ISO timestamp `a` is later than `b` (string order if unparseable). */
export function isLater(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta > tb;
  return a > b;
}

/**
 * The newest of `states` if it is newer than the local `issue` (by
 * `updated`), else undefined (the local version is the effective one). Ties
 * go to the local version, then to the earlier state in `states`.
 */
export function newestElsewhere(
  issue: { updated?: string },
  states: readonly IssueStateElsewhere[] = [],
): IssueStateElsewhere | undefined {
  let newest: IssueStateElsewhere | undefined;
  for (const state of states) {
    if (isLater(state.updated, newest?.updated ?? issue.updated ?? '')) {
      newest = state;
    }
  }
  return newest;
}

/**
 * The issues that have no file in this working tree (their ID is not in
 * `localIds`) but have a version elsewhere, by ascending ID. For each, the
 * newest version in `states` that has its parsed issue (by `updated`; ties
 * go to the earlier state, so worktrees win over branches), plus where it
 * was found.
 */
export function issuesOnlyElsewhere(
  localIds: ReadonlySet<number>,
  states: ReadonlyMap<number, readonly IssueStateElsewhere[]>,
): IssueOnlyElsewhere[] {
  const found: IssueOnlyElsewhere[] = [];
  for (const [id, list] of states) {
    if (localIds.has(id)) continue;
    let newest: IssueStateElsewhere | undefined;
    for (const state of list) {
      if (state.issue && (!newest || isLater(state.updated, newest.updated))) {
        newest = state;
      }
    }
    if (!newest?.issue) continue;
    const { ref, worktree } = newest;
    found.push({
      issue: newest.issue,
      foundElsewhere: worktree === undefined ? { ref } : { ref, worktree },
    });
  }
  return found.sort((a, b) => a.issue.id - b.issue.id);
}

/**
 * The effective status and assignee of `issue`: those of the newest version
 * among the local one and `states`.
 */
export function effectiveState(
  issue: Pick<Issue, 'status' | 'assignee'> & { updated?: string },
  states: readonly IssueStateElsewhere[] = [],
): Pick<Issue, 'status' | 'assignee'> {
  return newestElsewhere(issue, states) ?? issue;
}

/**
 * Whether the effective version of `issue` is a claim (in a held status,
 * see `heldStatuses` in `src/core/workflow.ts`: the active status, default
 * `in_progress`, or the review status; and assigned) found on another
 * branch or worktree; returns where and by whom.
 */
export function claimedElsewhere(
  issue: { updated?: string },
  config: WorkflowConfig,
  states: readonly IssueStateElsewhere[] = [],
): ClaimedElsewhere | undefined {
  const newest = newestElsewhere(issue, states);
  if (
    newest === undefined ||
    !isHeldStatus(config, newest.status) ||
    !newest.assignee.trim()
  ) {
    return undefined;
  }
  return toClaimedElsewhere(newest);
}

/**
 * Whether the local `issue` is open but its effective version (the newest
 * one, see {@link newestElsewhere}) is closed on another branch or in
 * another worktree; returns where, in which status and when.
 */
export function closedElsewhere(
  issue: { status: Status; updated?: string },
  config: WorkflowConfig,
  states: readonly IssueStateElsewhere[] = [],
): ClosedElsewhere | undefined {
  if (isClosedStatus(config, issue.status)) return undefined;
  const newest = newestElsewhere(issue, states);
  if (newest === undefined || !isClosedStatus(config, newest.status)) {
    return undefined;
  }
  return toClosedElsewhere(newest);
}

/** Where `state` was found, its status and its `updated`. */
export function toClosedElsewhere(state: IssueStateElsewhere): ClosedElsewhere {
  const { ref, worktree, status, updated } = state;
  return worktree === undefined
    ? { ref, status, updated }
    : { ref, worktree, status, updated };
}

/**
 * The marks for `issue` from its versions elsewhere (`claimedElsewhere` or
 * `closedElsewhere`), or undefined if neither applies.
 */
export function elsewhereMarks(
  issue: { status: Status; updated?: string },
  config: WorkflowConfig,
  states: readonly IssueStateElsewhere[] = [],
): ElsewhereMarks | undefined {
  const claim = claimedElsewhere(issue, config, states);
  if (claim) return { claimedElsewhere: claim };
  const closed = closedElsewhere(issue, config, states);
  if (closed) return { closedElsewhere: closed };
  return undefined;
}

/** Where and by whom `state` is held (its location, assignee and `updated`). */
export function toClaimedElsewhere(
  state: IssueStateElsewhere,
): ClaimedElsewhere {
  const { ref, worktree, assignee, updated } = state;
  return worktree === undefined
    ? { ref, assignee, updated }
    : { ref, worktree, assignee, updated };
}

/**
 * Human description of where a state was found: `on branch X`, or
 * `in worktree P (branch X)` / `in worktree P (detached HEAD)`.
 */
export function describeLocation(
  where: Pick<IssueStateElsewhere, 'ref' | 'worktree'>,
): string {
  if (where.worktree === undefined) return `on branch ${where.ref}`;
  const head = where.ref === 'HEAD' ? 'detached HEAD' : `branch ${where.ref}`;
  return `in worktree ${where.worktree} (${head})`;
}
