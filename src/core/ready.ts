import { type ClaimUser, isAssignedTo } from './claim.ts';
import { openBlockers } from './dependencies.ts';
import { effectiveState, type IssueStateElsewhere } from './elsewhere.ts';
import {
  filterIssues,
  type IssueQuery,
  type QueryConfig,
  sortIssues,
} from './query.ts';
import type { Issue } from './types.ts';
import {
  activeStatus,
  isClosedStatus,
  type StatusConfig,
  type WorkflowConfig,
} from './workflow.ts';

/**
 * "Ready" work (pure; no I/O): what `gitrac ready` lists and `gitrac next`
 * picks from.
 *
 * An issue is ready for a user when it is {@link isAvailableTo available} to
 * them and every blocker is resolved (in a closed status, or deleted; see
 * `src/core/dependencies.ts`).
 *
 * Availability uses the issue's *effective* state: the newest version here
 * or on another branch / worktree (`elsewhere`, see `src/core/elsewhere.ts`),
 * so an issue claimed (or closed) in another worktree isn't offered here.
 * Blockers are judged by their local state.
 */

/** Versions of issues on other branches and worktrees, by issue ID. */
export type StatesElsewhere = ReadonlyMap<
  number,
  readonly IssueStateElsewhere[]
>;

/**
 * Whether `issue` is free for `user` to work on: its effective state (the
 * newest of the local version and `elsewhere`) is open (not a closed status)
 * and unassigned or assigned to them. Issues assigned to someone else — in
 * any status, here or in a newer version on another branch or worktree —
 * are not available.
 *
 * This is the single "can I take this?" check behind `ready` and `next`.
 */
export function isAvailableTo(
  issue: Pick<Issue, 'status' | 'assignee'> & { updated?: string },
  user: ClaimUser,
  config: StatusConfig,
  elsewhere: readonly IssueStateElsewhere[] = [],
): boolean {
  const { status, assignee } = effectiveState(issue, elsewhere);
  if (isClosedStatus(config, status)) return false;
  return !assignee.trim() || isAssignedTo(assignee, user);
}

/** Whether `issue` is ready for `user` (available and unblocked). */
export function isReady(
  issue: Issue,
  user: ClaimUser,
  byId: ReadonlyMap<number, Issue>,
  config: StatusConfig,
  elsewhere: StatesElsewhere = new Map(),
): boolean {
  return (
    isAvailableTo(issue, user, config, elsewhere.get(issue.id)) &&
    openBlockers(issue, byId, config).length === 0
  );
}

/**
 * The issues ready for `user`, filtered by `query` (status, priority, label,
 * mine, search; without a status filter: every open status) and sorted by
 * `query.sort` (ties by ID). `issues` must include the closed issues, so
 * blockers can be looked up; `byId` indexes them. `elsewhere`: the issues'
 * versions on other branches and worktrees.
 */
export function readyIssues(
  issues: Issue[],
  byId: ReadonlyMap<number, Issue>,
  user: ClaimUser,
  query: IssueQuery,
  config: QueryConfig,
  elsewhere: StatesElsewhere = new Map(),
): Issue[] {
  const candidates = filterIssues(issues, query, config).filter((issue) =>
    isReady(issue, user, byId, config, elsewhere),
  );
  return sortIssues(candidates, query.sort, config);
}

/**
 * The issue `next` picks: the first ready issue that isn't already in the
 * configured active status (claimed; default `in_progress`) — here or, per its effective state, in another
 * worktree or on another branch. Your own in-progress work is listed by
 * `ready` but skipped here, so several agents sharing one git identity
 * (e.g. in separate worktrees) each get a different issue.
 */
export function nextIssue(
  ready: Issue[],
  config: WorkflowConfig,
  elsewhere: StatesElsewhere = new Map(),
): Issue | undefined {
  const active = activeStatus(config);
  return ready.find(
    (issue) => effectiveState(issue, elsewhere.get(issue.id)).status !== active,
  );
}
