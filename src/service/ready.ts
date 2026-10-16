import type { ClaimUser } from '../core/claim.ts';
import { indexIssues } from '../core/dependencies.ts';
import type { ElsewhereMarks } from '../core/elsewhere.ts';
import { GitracError } from '../core/errors.ts';
import type { IssueQuery, QueryConfig } from '../core/query.ts';
import { nextIssue, readyIssues, type StatesElsewhere } from '../core/ready.ts';
import {
  type StaleClaim,
  type StaleOptions,
  staleClaim,
} from '../core/stale.ts';
import type { Issue } from '../core/types.ts';
import { isClosedStatus, type WorkflowConfig } from '../core/workflow.ts';
import { issueStatesElsewhere } from '../git/elsewhere.ts';
import { withRepoLock } from '../git/lock.ts';
import { assertValidUser, type ClaimResult, claimIssue } from './claim.ts';
import { loadConfig, type ServiceContext } from './context.ts';
import { type IssueListing, loadAllIssues, marksFromStates } from './list.ts';

/**
 * `gitrac ready` / `gitrac next [--claim]`: the rules are in
 * `src/core/ready.ts`; this loads the issues (open and closed, for the
 * blockers) and, for `next --claim`, picks and claims under the repo lock.
 */

export interface ReadyListing extends IssueListing {
  /**
   * Ready issues (the user's own) claimed on another branch or worktree
   * (`claimedElsewhere`). Ready issues are never closed elsewhere.
   */
  marks: Map<number, ElsewhereMarks>;
  /**
   * The issue `next` picks: the first ready one not in progress anywhere
   * (or with a stale claim).
   */
  next: Issue | undefined;
  /** With `stale`: the ready issues whose claim is stale, by ID. */
  staleClaims: Map<number, StaleClaim>;
}

/** Options of {@link listReadyIssues} and {@link claimNextIssue}. */
export interface ReadyOptions {
  /**
   * Treat stale claims (no activity for `stale.maxAgeMs`; see `staleClaim`
   * in `src/core/stale.ts`) as available: `ready` lists them and `next`
   * can pick them. Without it, a claim by someone else is never available.
   */
  stale?: StaleOptions;
}

/**
 * The issues whose effective state is a stale claim, by ID. A closed local
 * issue is left out: `claim` refuses it (taking it over would reopen it).
 */
function findStaleClaims(
  issues: readonly Issue[],
  config: WorkflowConfig,
  elsewhere: StatesElsewhere,
  stale: StaleOptions | undefined,
): Map<number, StaleClaim> {
  const claims = new Map<number, StaleClaim>();
  if (!stale) return claims;
  for (const issue of issues) {
    if (isClosedStatus(config, issue.status)) continue;
    const claim = staleClaim(issue, config, elsewhere.get(issue.id), stale);
    if (claim) claims.set(issue.id, claim);
  }
  return claims;
}

/**
 * The issues ready for `user` (read-only; no lock): open, unassigned or
 * theirs, and not blocked by an open issue; filtered and sorted per `query`.
 * Judged by each issue's effective state, so issues claimed (or closed) on
 * another branch or in another worktree are left out (see
 * `src/core/elsewhere.ts`), unless their claim is stale (`options.stale`).
 * `next` is the one `gitrac next` picks.
 */
export async function listReadyIssues(
  dir: string,
  user: ClaimUser,
  query: IssueQuery,
  config: QueryConfig & WorkflowConfig,
  options: ReadyOptions = {},
): Promise<ReadyListing> {
  const [{ issues, unreadable }, elsewhere] = await Promise.all([
    loadAllIssues(dir),
    issueStatesElsewhere(dir),
  ]);
  const staleClaims = findStaleClaims(issues, config, elsewhere, options.stale);
  const stale = new Set(staleClaims.keys());
  const ready = readyIssues(
    issues,
    indexIssues(issues),
    user,
    query,
    config,
    elsewhere,
    { stale },
  );
  // Keep only the ready ones (not blocked, matching the query).
  const readyIds = new Set(ready.map((i) => i.id));
  for (const id of staleClaims.keys()) {
    if (!readyIds.has(id)) staleClaims.delete(id);
  }
  return {
    issues: ready,
    unreadable,
    marks: marksFromStates(ready, config, elsewhere),
    next: nextIssue(ready, config, elsewhere, { stale }),
    staleClaims,
  };
}

/** `no_ready_issues` (exit 5): nothing for `next` to pick. */
export function noReadyIssues(): GitracError {
  return new GitracError('no_ready_issues', 'No ready issues');
}

/**
 * The issue `next` would pick for `user` (read-only): the first ready issue
 * that isn't already in progress (here or elsewhere). Throws `no_ready_issues` if there is none.
 */
export async function findNextIssue(
  dir: string,
  user: ClaimUser,
  query: IssueQuery,
  config: QueryConfig & WorkflowConfig,
  options: ReadyOptions = {},
): Promise<{ issue: Issue; unreadable: string[]; staleClaim?: StaleClaim }> {
  const {
    next: issue,
    unreadable,
    staleClaims,
  } = await listReadyIssues(dir, user, query, config, options);
  if (!issue) throw noReadyIssues();
  const claim = staleClaims.get(issue.id);
  return claim
    ? { issue, unreadable, staleClaim: claim }
    : { issue, unreadable };
}

/**
 * Pick the next ready issue for the context's identity and claim it, all
 * under one hold of the repo lock — so concurrent `next --claim`s (other
 * agents, worktrees, the web UI) never pick the same issue. Uses the normal
 * claim rules (`claimIssue`). Throws `no_ready_issues` if nothing is ready.
 *
 * With `options.stale`, it can pick an issue whose claim is stale and take
 * it over: the scan runs under the lock, and `claimIssue` checks again that
 * the claim is still stale before it takes it, so a claim renewed meanwhile
 * is never taken. `staleClaim` in the result is the claim taken over.
 */
export async function claimNextIssue(
  ctx: ServiceContext,
  query: IssueQuery,
  options: { comment?: string } & ReadyOptions = {},
): Promise<ClaimResult & { unreadable: string[] }> {
  const user = await ctx.identity();
  assertValidUser(user, options.comment, { claim: true });
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const { issue, unreadable, staleClaim } = await findNextIssue(
      ctx.dir,
      user,
      query,
      config,
      { stale: options.stale },
    );
    // `claimIssue` scans again and takes the claim only if still stale.
    const result = await claimIssue(ctx, issue.id, {
      comment: options.comment,
      ...(staleClaim ? { stale: options.stale } : {}),
    });
    return { ...result, unreadable };
  });
}
