import {
  type ClaimUser,
  claimAssignee,
  decideClaim,
  decideUnclaim,
} from '../core/claim.ts';
import { findAssigneeByEmail } from '../core/config.ts';
import {
  type ClaimedElsewhere,
  describeLocation,
  toClosedElsewhere,
} from '../core/elsewhere.ts';
import { GitracError, invalidInput } from '../core/errors.ts';
import { nextTimestamp } from '../core/timestamp.ts';
import type { Config, Issue } from '../core/types.ts';
import { authorError, hasLineBreak } from '../core/validate.ts';
import { activeStatus } from '../core/workflow.ts';
import { relocateIssue, writeConfig } from '../fs/issue-store.ts';
import { issueStatesElsewhere } from '../git/elsewhere.ts';
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
  | (IssueChange & {
      changed: true;
      /**
       * claim: the effective state was already the user's own claim on
       * another branch or worktree (now claimed here too). unclaim: the
       * released claim was the effective version elsewhere (superseded by
       * the local release).
       */
      elsewhere?: ClaimedElsewhere;
    })
  | { changed: false; issue: Issue; config: Config };

export interface ClaimOptions {
  /** Comment to add (by the context's identity). */
  comment?: string;
  /** claim: take over someone else's issue, or reopen and claim a closed one. unclaim: release someone else's issue. */
  force?: boolean;
}

/**
 * Check the acting user before the lock is taken. The name is the author of
 * a (non-blank) comment, so it must then be a valid author (see
 * `authorError`). A claim writes the email or name as the assignee (and both
 * into `config.assignees`), so for a claim they must have no line break.
 * Throws `invalid_input` if not.
 */
export function assertValidUser(
  user: ClaimUser,
  comment: string | undefined,
  options: { claim: boolean },
): void {
  const error = comment?.trim() ? authorError(user.name) : null;
  if (error) throw invalidInput(error);
  if (options.claim && (hasLineBreak(user.name) || hasLineBreak(user.email))) {
    throw invalidInput(
      `Invalid user ${JSON.stringify(claimAssignee(user))}: name and email must not contain line breaks`,
    );
  }
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
 * set it to the configured active status (`activeStatus`, default
 * `in_progress`). Throws `already_claimed` if someone else has it (here,
 * or in a newer version on another branch or in another worktree, committed
 * or not; `details.claimedElsewhere` says where) and `issue_closed` if it is
 * closed here or in a newer version elsewhere (`details.closedElsewhere`
 * says where). `force` overrides both: a closed issue is reopened; a close
 * elsewhere is superseded by the new claim. Adds the user to
 * `config.assignees` if their email is new.
 */
export async function claimIssue(
  ctx: ServiceContext,
  id: number,
  options: ClaimOptions = {},
): Promise<ClaimResult> {
  const user = await ctx.identity();
  assertValidUser(user, options.comment, { claim: true });
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const stored = await loadStoredIssue(ctx.dir, id);
    const { issue } = stored;
    // Every worktree shares the repo lock, so a claim in another worktree
    // can't slip in between this scan and our write.
    const elsewhere = (await issueStatesElsewhere(ctx.dir, { ids: [id] })).get(
      id,
    );

    // Decided under the lock, on the freshly-read issue.
    const active = activeStatus(config);
    const decision = decideClaim(issue, user, config, {
      force: options.force,
      elsewhere,
    });
    if (decision.action === 'already-claimed') {
      const where = decision.elsewhere;
      throw new GitracError(
        'already_claimed',
        where
          ? `Issue #${id} is already claimed by ${where.assignee} (${active}) ${describeLocation(where)}.`
          : `Issue #${id} is already claimed by ${decision.assignee} (${active}).`,
        {
          details: where
            ? { id, assignee: where.assignee, claimedElsewhere: where }
            : { id, assignee: decision.assignee },
        },
      );
    }
    if (decision.action === 'closed') {
      const where = decision.elsewhere;
      throw new GitracError(
        'issue_closed',
        where
          ? `Issue #${id} is closed (${where.status}) ${describeLocation(where)}.`
          : `Issue #${id} is closed (${issue.status}).`,
        {
          details: where
            ? { id, status: where.status, closedElsewhere: where }
            : { id, status: issue.status },
        },
      );
    }
    if (decision.action === 'noop') {
      return { changed: false, issue, config };
    }

    // Use email as the canonical identifier if available, else the name
    issue.assignee = claimAssignee(user);
    issue.status = active;

    // Add the user to config.assignees if not already present (by email)
    let configChanged = false;
    if (user.email && !findAssigneeByEmail(config.assignees, user.email)) {
      config.assignees.push({ name: user.name, email: user.email });
      await writeConfig(ctx.dir, config);
      configChanged = true;
    }
    // Strictly later than every version, so this one supersedes them.
    const now = nextTimestamp([
      issue.updated,
      ...(elsewhere ?? []).map((s) => s.updated),
    ]);
    issue.updated = now;
    addClaimComment(issue, user.name, options.comment, now);

    // The active status is open (config validation), so write to the open dir; the old file
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
    return {
      changed: true,
      issue,
      paths,
      config,
      commit,
      ...(decision.heldElsewhere ? { elsewhere: decision.heldElsewhere } : {}),
    };
  });
}

/**
 * Give an issue back: clear the assignee and move it from the active status
 * (default `in_progress`) back to the unclaim status (`unclaimStatus`,
 * default `todo`); other statuses are kept. Judged by the issue's effective
 * state (here, in other worktrees, or on other branches; see
 * `src/core/elsewhere.ts`): a claim held elsewhere is released by writing a
 * newer local version, which supersedes it (`elsewhere` in the result says
 * where it was). Throws `already_claimed` if it is someone else's (unless
 * `force`; `details.claimedElsewhere` says where, if not here) and
 * `issue_closed` if it is closed here or in the effective state.
 */
export async function unclaimIssue(
  ctx: ServiceContext,
  id: number,
  options: ClaimOptions = {},
): Promise<ClaimResult> {
  const user = await ctx.identity();
  assertValidUser(user, options.comment, { claim: false });
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const stored = await loadStoredIssue(ctx.dir, id);
    const { issue } = stored;
    // Under the (shared) repo lock, like claim.
    const elsewhere = (await issueStatesElsewhere(ctx.dir, { ids: [id] })).get(
      id,
    );

    const decision = decideUnclaim(issue, user, config, {
      force: options.force,
      elsewhere,
    });
    if (decision.action === 'not-yours') {
      const where = decision.elsewhere;
      throw new GitracError(
        'already_claimed',
        where
          ? `Issue #${id} is claimed by ${where.assignee} ${describeLocation(where)}, not you.`
          : `Issue #${id} is claimed by ${decision.assignee}, not you.`,
        {
          details: where
            ? { id, assignee: where.assignee, claimedElsewhere: where }
            : { id, assignee: decision.assignee },
        },
      );
    }
    if (decision.action === 'closed') {
      const where = decision.elsewhere;
      throw new GitracError(
        'issue_closed',
        where
          ? `Issue #${id} is closed (${decision.status}) ${describeLocation(where)}; nothing to release.`
          : `Issue #${id} is closed (${decision.status}); nothing to release.`,
        {
          details: where
            ? {
                id,
                status: decision.status,
                closedElsewhere: toClosedElsewhere(where),
              }
            : { id, status: decision.status },
        },
      );
    }
    if (decision.action === 'noop') {
      return { changed: false, issue, config };
    }

    issue.assignee = '';
    issue.status = decision.status;
    // Strictly later than every version, so this one supersedes them.
    const now = nextTimestamp([
      issue.updated,
      ...(elsewhere ?? []).map((s) => s.updated),
    ]);
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
    return {
      changed: true,
      issue,
      paths,
      config,
      commit,
      ...(decision.elsewhere ? { elsewhere: decision.elsewhere } : {}),
    };
  });
}
