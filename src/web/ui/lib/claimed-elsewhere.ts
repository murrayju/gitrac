import {
  type ClaimedElsewhere,
  type ClosedElsewhere,
  describeLocation,
} from '../../../core/elsewhere.ts';

/**
 * Wording for the "claimed (or closed) in another worktree / on another
 * branch" indicators (`claimedElsewhere` / `closedElsewhere` from the API;
 * see `src/core/elsewhere.ts`). `who` is the assignee's display name;
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
