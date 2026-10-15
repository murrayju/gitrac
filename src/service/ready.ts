import type { ClaimUser } from '../core/claim.ts';
import { indexIssues } from '../core/dependencies.ts';
import { GitracError } from '../core/errors.ts';
import type { IssueQuery } from '../core/query.ts';
import { nextIssue, readyIssues } from '../core/ready.ts';
import type { Config, Issue } from '../core/types.ts';
import { withRepoLock } from '../git/lock.ts';
import { type ClaimResult, claimIssue } from './claim.ts';
import { loadConfig, type ServiceContext } from './context.ts';
import { type IssueListing, loadAllIssues } from './list.ts';

/**
 * `gitrac ready` / `gitrac next [--claim]`: the rules are in
 * `src/core/ready.ts`; this loads the issues (open and closed, for the
 * blockers) and, for `next --claim`, picks and claims under the repo lock.
 */

/**
 * The issues ready for `user` (read-only; no lock): open, unassigned or
 * theirs, and not blocked by an open issue; filtered and sorted per `query`.
 */
export async function listReadyIssues(
  dir: string,
  user: ClaimUser,
  query: IssueQuery,
  config: Pick<Config, 'assignees'>,
): Promise<IssueListing> {
  const { issues, unreadable } = await loadAllIssues(dir);
  return {
    issues: readyIssues(issues, indexIssues(issues), user, query, config),
    unreadable,
  };
}

/** `no_ready_issues` (exit 5): nothing for `next` to pick. */
export function noReadyIssues(): GitracError {
  return new GitracError('no_ready_issues', 'No ready issues');
}

/**
 * The issue `next` would pick for `user` (read-only): the first ready issue
 * that isn't already in progress. Throws `no_ready_issues` if there is none.
 */
export async function findNextIssue(
  dir: string,
  user: ClaimUser,
  query: IssueQuery,
  config: Pick<Config, 'assignees'>,
): Promise<{ issue: Issue; unreadable: string[] }> {
  const { issues, unreadable } = await listReadyIssues(
    dir,
    user,
    query,
    config,
  );
  const issue = nextIssue(issues);
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
