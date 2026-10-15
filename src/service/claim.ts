import { claimAssignee, decideClaim, decideUnclaim } from '../core/claim.ts';
import { findAssigneeByEmail } from '../core/config.ts';
import { GitracError } from '../core/errors.ts';
import type { Config, Issue } from '../core/types.ts';
import { relocateIssue, writeConfig } from '../fs/issue-store.ts';
import { withRepoLock } from '../git/lock.ts';
import {
  assetPaths,
  CONFIG_PATH,
  commitChange,
  commitMessage,
  loadConfig,
  type ServiceContext,
} from './context.ts';
import type { IssueChange } from './issues.ts';
import { loadStoredIssue } from './load.ts';

/**
 * Claim / unclaim: the rules live in `src/core/claim.ts`; this applies them
 * to the issue on disk under the repo lock, so two concurrent claims can't
 * both win. Error messages are surface-neutral (no CLI flags or commands):
 * adapters append their own hints by error code (see `src/cli/commands/claim.ts`).
 */

/**
 * The result of claim/unclaim: the change, or `changed: false` when there was
 * nothing to do (then nothing was written, including any comment).
 */
export type ClaimResult =
  | (IssueChange & { changed: true })
  | { changed: false; issue: Issue; config: Config };

export interface ClaimOptions {
  /** Comment to add (by the context's identity). */
  comment?: string;
  /** claim: take over someone else's issue, or reopen and claim a closed one. unclaim: release someone else's issue. */
  force?: boolean;
}

/** Append the (trimmed) comment, if not blank. */
function addClaimComment(
  issue: Issue,
  author: string,
  body: string | undefined,
  timestamp: string,
): void {
  const text = body?.trim();
  if (text) issue.comments.push({ author, timestamp, body: text });
}

/**
 * Assign the issue to the context's identity (email if known, else name) and
 * set it `in_progress`. Throws `already_claimed` if someone else has it and
 * `issue_closed` if it is closed (`force` overrides both; a closed issue is
 * reopened). Adds the user to `config.assignees` if their email is new.
 */
export async function claimIssue(
  ctx: ServiceContext,
  id: number,
  options: ClaimOptions = {},
): Promise<ClaimResult> {
  const user = await ctx.identity();
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const stored = await loadStoredIssue(ctx.dir, id);
    const { issue } = stored;

    // Decided under the lock, on the freshly-read issue.
    const decision = decideClaim(issue, user, {
      force: options.force,
      inClosedDir: stored.closed,
    });
    if (decision.action === 'already-claimed') {
      throw new GitracError(
        'already_claimed',
        `Issue #${id} is already claimed by ${decision.assignee} (in_progress).`,
        { details: { id, assignee: decision.assignee } },
      );
    }
    if (decision.action === 'closed') {
      throw new GitracError(
        'issue_closed',
        `Issue #${id} is closed (${issue.status}).`,
        { details: { id, status: issue.status } },
      );
    }
    if (decision.action === 'noop') {
      return { changed: false, issue, config };
    }

    // Use email as the canonical identifier if available, else the name
    issue.assignee = claimAssignee(user);
    issue.status = 'in_progress';

    // Add the user to config.assignees if not already present (by email)
    let configChanged = false;
    if (user.email && !findAssigneeByEmail(config.assignees, user.email)) {
      config.assignees.push({ name: user.name, email: user.email });
      await writeConfig(ctx.dir, config);
      configChanged = true;
    }
    const now = new Date().toISOString();
    issue.updated = now;
    addClaimComment(issue, user.name, options.comment, now);

    // in_progress is an open status, so write to the open dir; the old file
    // goes if it was in the closed dir or its name doesn't match the title.
    const paths = await relocateIssue(ctx.dir, issue, stored, {
      closed: false,
    });
    if (configChanged) paths.push(CONFIG_PATH);
    paths.push(...assetPaths(issue));

    const commit = await commitChange(ctx, config, {
      operation: 'claim',
      issue,
      paths,
      message: commitMessage(config, `claim #${id} ${issue.title}`),
    });
    return { changed: true, issue, paths, config, commit };
  });
}

/**
 * Give an issue back: clear the assignee and move `in_progress` back to
 * `todo`. Throws `already_claimed` if it is someone else's (unless `force`)
 * and `issue_closed` if it is closed.
 */
export async function unclaimIssue(
  ctx: ServiceContext,
  id: number,
  options: ClaimOptions = {},
): Promise<ClaimResult> {
  const user = await ctx.identity();
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const stored = await loadStoredIssue(ctx.dir, id);
    const { issue } = stored;

    const decision = decideUnclaim(issue, user, {
      force: options.force,
      inClosedDir: stored.closed,
    });
    if (decision.action === 'not-yours') {
      throw new GitracError(
        'already_claimed',
        `Issue #${id} is claimed by ${decision.assignee}, not you.`,
        { details: { id, assignee: decision.assignee } },
      );
    }
    if (decision.action === 'closed') {
      throw new GitracError(
        'issue_closed',
        `Issue #${id} is closed (${issue.status}); nothing to release.`,
        { details: { id, status: issue.status } },
      );
    }
    if (decision.action === 'noop') {
      return { changed: false, issue, config };
    }

    issue.assignee = '';
    if (issue.status === 'in_progress') {
      issue.status = 'todo';
    }
    const now = new Date().toISOString();
    issue.updated = now;
    addClaimComment(issue, user.name, options.comment, now);

    // Replaces the old file if its name didn't match the title's slug.
    const paths = await relocateIssue(ctx.dir, issue, stored, {
      closed: false,
    });
    paths.push(...assetPaths(issue));

    const commit = await commitChange(ctx, config, {
      operation: 'unclaim',
      issue,
      paths,
      message: commitMessage(config, `unclaim #${id} ${issue.title}`),
    });
    return { changed: true, issue, paths, config, commit };
  });
}
