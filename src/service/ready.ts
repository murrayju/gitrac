import type { ClaimUser } from '../core/claim.ts';
import { indexIssues } from '../core/dependencies.ts';
import { type ClaimedElsewhere, claimedElsewhere } from '../core/elsewhere.ts';
import { GitracError } from '../core/errors.ts';
import type { IssueQuery, QueryConfig } from '../core/query.ts';
import { nextIssue, readyIssues } from '../core/ready.ts';
import type { Issue } from '../core/types.ts';
import type { WorkflowConfig } from '../core/workflow.ts';
import { issueStatesElsewhere } from '../git/elsewhere.ts';
import { withRepoLock } from '../git/lock.ts';
import { type ClaimResult, claimIssue } from './claim.ts';
import { loadConfig, type ServiceContext } from './context.ts';
import { type IssueListing, loadAllIssues } from './list.ts';

/**
 * `gitrac ready` / `gitrac next [--claim]`: the rules are in
 * `src/core/ready.ts`; this loads the issues (open and closed, for the
 * blockers) and, for `next --claim`, picks and claims under the repo lock.
 */

export interface ReadyListing extends IssueListing {
  /** Ready issues (the user's own) claimed on another branch or worktree. */
  claimedElsewhere: Map<number, ClaimedElsewhere>;
  /** The issue `next` picks: the first ready one not in progress anywhere. */
  next: Issue | undefined;
}

/**
 * The issues ready for `user` (read-only; no lock): open, unassigned or
 * theirs, and not blocked by an open issue; filtered and sorted per `query`.
 * Judged by each issue's effective state, so issues claimed (or closed) on
 * another branch or in another worktree are left out (see
 * `src/core/elsewhere.ts`). `next` is the one `gitrac next` picks.
 */
export async function listReadyIssues(
  dir: string,
  user: ClaimUser,
  query: IssueQuery,
  config: QueryConfig & WorkflowConfig,
): Promise<ReadyListing> {
  const [{ issues, unreadable }, elsewhere] = await Promise.all([
    loadAllIssues(dir),
    issueStatesElsewhere(dir),
  ]);
  const ready = readyIssues(
    issues,
    indexIssues(issues),
    user,
    query,
    config,
    elsewhere,
  );
  const claims = new Map<number, ClaimedElsewhere>();
  for (const issue of ready) {
    const claim = claimedElsewhere(issue, config, elsewhere.get(issue.id));
    if (claim) claims.set(issue.id, claim);
  }
  return {
    issues: ready,
    unreadable,
    claimedElsewhere: claims,
    next: nextIssue(ready, config, elsewhere),
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
): Promise<{ issue: Issue; unreadable: string[] }> {
  const { next: issue, unreadable } = await listReadyIssues(
    dir,
    user,
    query,
    config,
  );
  if (!issue) throw noReadyIssues();
  return { issue, unreadable };
}

/**
 * Pick the next ready issue for the context's identity and claim it, all
 * under one hold of the repo lock — so concurrent `next --claim`s (other
 * agents, worktrees, the web UI) never pick the same issue. Uses the normal
 * claim rules (`claimIssue`). Throws `no_ready_issues` if nothing is ready.
 */
export async function claimNextIssue(
  ctx: ServiceContext,
  query: IssueQuery,
  options: { comment?: string } = {},
): Promise<ClaimResult & { unreadable: string[] }> {
  const user = await ctx.identity();
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const { issue, unreadable } = await findNextIssue(
      ctx.dir,
      user,
      query,
      config,
    );
    const result = await claimIssue(ctx, issue.id, {
      comment: options.comment,
    });
    return { ...result, unreadable };
  });
}
