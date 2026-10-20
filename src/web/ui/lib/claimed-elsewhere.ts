import {
  type ClaimedElsewhere,
  type ClosedElsewhere,
  describeLocation,
  type FoundElsewhere,
} from '../../../core/elsewhere.ts';
import { formatDuration, type StaleClaim } from '../../../core/stale.ts';
import type { Status } from '../../../core/types.ts';
import {
  activeStatus,
  isHeldStatus,
  type WorkflowConfig,
} from '../../../core/workflow.ts';

/**
 * Wording for the "claimed (or closed) in another worktree / on another
 * branch" indicators (`claimedElsewhere` / `closedElsewhere` from the API;
 * see `src/core/elsewhere.ts`), and for issues that exist only there
 * (`foundElsewhere`). `who` is the assignee's display name;
 * `label` is the closed status's display name.
 */

/**
 * The held status of `claim` (the active or the review status), for its
 * badge style and label. The active status if the claim has no status (an
 * older server) or a status that this config does not hold.
 */
export function claimStatus(
  claim: Pick<ClaimedElsewhere, 'status'>,
  config: WorkflowConfig,
): Status {
  const status = (claim as { status?: Status }).status;
  return status !== undefined && isHeldStatus(config, status)
    ? status
    : activeStatus(config);
}

/** Last path segment of a worktree path (POSIX or Windows). */
export function worktreeName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/**
 * Compact badge text: `claimed by Bob in wt-1` / `claimed by Bob on
 * origin/x`. `label` is the display name of a held status other than the
 * active one (e.g. the review status): `Review by Bob in wt-1`.
 */
export function shortClaimText(
  claim: ClaimedElsewhere,
  who: string,
  label?: string,
): string {
  const what = label === undefined ? 'claimed' : label;
  return claim.worktree === undefined
    ? `${what} by ${who} on ${claim.ref}`
    : `${what} by ${who} in ${worktreeName(claim.worktree)}`;
}

/**
 * Full sentence: `Claimed by Bob in worktree /path (branch agent-1)` /
 * `Claimed by Bob on branch origin/agent-1` (same wording as the CLI's).
 * With `label` (a held status other than the active one):
 * `Claimed by Bob (Review) on branch origin/agent-1`.
 */
export function fullClaimText(
  claim: ClaimedElsewhere,
  who: string,
  label?: string,
): string {
  const status = label === undefined ? '' : ` (${label})`;
  return `Claimed by ${who}${status} ${describeLocation(claim)}`;
}

/**
 * Stale badge text: `stale: no activity for 3h` (the time since the
 * claim's last activity at `now`, in ms since the epoch).
 */
export function staleClaimText(claim: StaleClaim, now: number): string {
  const at = Date.parse(claim.updated);
  if (!Number.isFinite(at)) return 'stale claim';
  return `stale: no activity for ${formatDuration(now - at)}`;
}

/**
 * Stale badge hover text: `Stale claim by Bob: last activity <iso>, no
 * activity for at least 2h`. `threshold` is the configured `staleAfter`.
 */
export function staleClaimTitle(
  claim: StaleClaim,
  who: string,
  threshold: string | undefined,
): string {
  const limit =
    threshold === undefined ? '' : `, no activity for at least ${threshold}`;
  return `Stale claim by ${who}: last activity ${claim.updated}${limit}`;
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
 * Hover text of a linked issue (`IssueRef`): its title, plus where it is
 * when it exists only elsewhere: `Sub task (Only in worktree /path (branch
 * agent-1))`.
 */
export function refHoverText(ref: {
  title: string;
  foundElsewhere?: FoundElsewhere;
}): string {
  return ref.foundElsewhere
    ? `${ref.title} (${fullFoundText(ref.foundElsewhere)})`
    : ref.title;
}

/**
 * The "blocked" notice of the dependencies panel, from the blockers
 * (`IssueRef`s), or null if none blocks. A blocker only elsewhere blocks in
 * any status, so when only those block, the notice says so.
 */
export function blockedNotice(
  blockedBy: readonly { resolved: boolean; foundElsewhere?: FoundElsewhere }[],
): string | null {
  const open = blockedBy.filter((ref) => !ref.resolved);
  if (open.length === 0) return null;
  return open.every((ref) => ref.foundElsewhere)
    ? 'Blocked by an issue that is only in another worktree or on another branch'
    : 'Blocked by an open issue';
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
