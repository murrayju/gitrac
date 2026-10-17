import {
  type ClaimedElsewhere,
  type ClosedElsewhere,
  describeLocation,
  type FoundElsewhere,
} from '../../../core/elsewhere.ts';

/**
 * Wording for the "claimed (or closed) in another worktree / on another
 * branch" indicators (`claimedElsewhere` / `closedElsewhere` from the API;
 * see `src/core/elsewhere.ts`), and for issues that exist only there
 * (`foundElsewhere`). `who` is the assignee's display name;
 * `label` is the closed status's display name.
 */

/** Last path segment of a worktree path (POSIX or Windows). */
export function worktreeName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Compact badge text: `claimed by Bob in wt-1` / `claimed by Bob on origin/x`. */
export function shortClaimText(claim: ClaimedElsewhere, who: string): string {
  return claim.worktree === undefined
    ? `claimed by ${who} on ${claim.ref}`
    : `claimed by ${who} in ${worktreeName(claim.worktree)}`;
}

/**
 * Full sentence: `Claimed by Bob in worktree /path (branch agent-1)` /
 * `Claimed by Bob on branch origin/agent-1` (same wording as the CLI's).
 */
export function fullClaimText(claim: ClaimedElsewhere, who: string): string {
  return `Claimed by ${who} ${describeLocation(claim)}`;
}

/** Compact badge text: `done in wt-1` / `done on origin/x`. */
export function shortCloseText(closed: ClosedElsewhere, label: string): string {
  return closed.worktree === undefined
    ? `${label} on ${closed.ref}`
    : `${label} in ${worktreeName(closed.worktree)}`;
}

/**
 * Full sentence: `Closed (Done) in worktree /path (branch agent-1)` /
 * `Closed (Done) on branch origin/agent-1` (same wording as the CLI's).
 */
export function fullCloseText(closed: ClosedElsewhere, label: string): string {
  return `Closed (${label}) ${describeLocation(closed)}`;
}

/** Compact badge text: `only in wt-1` / `only on origin/x`. */
export function shortFoundText(found: FoundElsewhere): string {
  return found.worktree === undefined
    ? `only on ${found.ref}`
    : `only in ${worktreeName(found.worktree)}`;
}

/**
 * Full text: `Only in worktree /path (branch agent-1)` / `Only on branch
 * origin/agent-1` (same wording as the CLI's `Elsewhere:  only ...`).
 */
export function fullFoundText(found: FoundElsewhere): string {
  return `Only ${describeLocation(found)}`;
}

/**
 * The notice of the read-only view of an issue that has no file in this
 * working tree: where it is, and what to do to edit it here.
 */
export function foundElsewhereNotice(found: FoundElsewhere): string {
  const fix =
    found.ref === 'HEAD'
      ? 'Commit it on a branch and merge that branch to edit it here.'
      : 'Merge that branch to edit it here.';
  return `This issue exists only ${describeLocation(found)}. ${fix}`;
}

/**
 * `issues` with the ones that exist only elsewhere (`foundElsewhere`) after
 * the local ones, as `GET /api/issues?elsewhere=1` and `gitrac ls
 * --elsewhere` list them. Keeps the order in each group.
 */
export function localFirst<T extends { foundElsewhere?: FoundElsewhere }>(
  issues: readonly T[],
): T[] {
  return [
    ...issues.filter((i) => !i.foundElsewhere),
    ...issues.filter((i) => i.foundElsewhere),
  ];
}
