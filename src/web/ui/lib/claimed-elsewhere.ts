import {
  type ClaimedElsewhere,
  describeLocation,
} from '../../../core/elsewhere.ts';

/**
 * Wording for the "claimed in another worktree / on another branch"
 * indicator (`claimedElsewhere` from the API; see `src/core/elsewhere.ts`).
 * `who` is the assignee's display name.
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
