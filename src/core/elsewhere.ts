import type { Issue, Status } from './types.ts';

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
}

/** Where (and by whom) an issue is claimed, when that's not this working tree. */
export interface ClaimedElsewhere {
  ref: string;
  worktree?: string;
  assignee: string;
  updated: string;
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
 * Whether the effective version of `issue` is a claim (in_progress and
 * assigned) found on another branch or worktree; returns where and by whom.
 */
export function claimedElsewhere(
  issue: { updated?: string },
  states: readonly IssueStateElsewhere[] = [],
): ClaimedElsewhere | undefined {
  const newest = newestElsewhere(issue, states);
  if (newest?.status !== 'in_progress' || !newest.assignee.trim()) {
    return undefined;
  }
  const { ref, worktree, assignee, updated } = newest;
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
