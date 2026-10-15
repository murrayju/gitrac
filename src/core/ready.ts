import { type ClaimUser, isAssignedTo } from './claim.ts';
import { openBlockers } from './dependencies.ts';
import { filterIssues, type IssueQuery, sortIssues } from './query.ts';
import type { Config, Issue } from './types.ts';
import { isClosedStatus } from './types.ts';

/**
 * "Ready" work (pure; no I/O): what `gitrac ready` lists and `gitrac next`
 * picks from.
 *
 * An issue is ready for a user when it is {@link isAvailableTo available} to
 * them and every blocker is resolved (closed — done or cancelled — or
 * deleted; see `src/core/dependencies.ts`).
 */

/**
 * Whether `issue` is free for `user` to work on: open (not done/cancelled)
 * and unassigned or assigned to them. Issues assigned to someone else — in
 * any status — are not available.
 *
 * This is the single "can I take this?" check behind `ready` and `next`;
 * extend it here (e.g. to also consider claims made on other branches).
 */
export function isAvailableTo(
  issue: Pick<Issue, 'status' | 'assignee'>,
  user: ClaimUser,
): boolean {
  if (isClosedStatus(issue.status)) return false;
  return !issue.assignee.trim() || isAssignedTo(issue.assignee, user);
}

/** Whether `issue` is ready for `user` (available and unblocked). */
export function isReady(
  issue: Issue,
  user: ClaimUser,
  byId: ReadonlyMap<number, Issue>,
): boolean {
  return isAvailableTo(issue, user) && openBlockers(issue, byId).length === 0;
}

/**
 * The issues ready for `user`, filtered by `query` (status, priority, label,
 * mine, search; without a status filter: every open status) and sorted by
 * `query.sort` (ties by ID). `issues` must include the closed issues, so
 * blockers can be looked up; `byId` indexes them.
 */
export function readyIssues(
  issues: Issue[],
  byId: ReadonlyMap<number, Issue>,
  user: ClaimUser,
  query: IssueQuery,
  config: Pick<Config, 'assignees'> = { assignees: [] },
): Issue[] {
  const candidates = filterIssues(issues, query, config).filter((issue) =>
    isReady(issue, user, byId),
  );
  return sortIssues(candidates, query.sort);
}

/**
 * The issue `next` picks: the first ready issue that isn't already
 * `in_progress` (claimed). Your own in-progress work is listed by `ready`
 * but skipped here, so several agents sharing one git identity each get a
 * different issue.
 */
export function nextIssue(ready: Issue[]): Issue | undefined {
  return ready.find((issue) => issue.status !== 'in_progress');
}
