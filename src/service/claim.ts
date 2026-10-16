import {
  type ClaimUser,
  claimAssignee,
  decideClaim,
  decideReview,
  decideUnclaim,
} from '../core/claim.ts';
import { findAssigneeByEmail } from '../core/config.ts';
import {
  type ClaimedElsewhere,
  describeLocation,
  effectiveState,
  toClosedElsewhere,
} from '../core/elsewhere.ts';
import { GitracError, invalidInput } from '../core/errors.ts';
import {
  claimAge,
  formatDuration,
  type StaleClaim,
  type StaleOptions,
  staleClaim,
} from '../core/stale.ts';
import { nextTimestamp } from '../core/timestamp.ts';
import type { Config, Issue } from '../core/types.ts';
import { authorError, hasLineBreak } from '../core/validate.ts';
import {
  activeStatus,
  isClosedStatus,
  reviewStatus,
} from '../core/workflow.ts';
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
import { loadStoredIssue, type Precondition } from './load.ts';

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
       * the local release). review: the claim handed off was the effective
       * version elsewhere (superseded by the local write).
       */
      elsewhere?: ClaimedElsewhere;
      /**
       * claim / unclaim with `stale`: the stale claim that was taken over
       * or released (someone else's, or the user's own).
       */
      staleClaim?: StaleClaim;
      /** claim with `renew`: the user's own claim was renewed (no other change). */
      renewed?: boolean;
    })
  | { changed: false; issue: Issue; config: Config };

export interface ClaimOptions {
  /** Comment to add (by the context's identity). */
  comment?: string;
  /**
   * claim: take over someone else's issue, or reopen and claim a closed one.
   * unclaim: release someone else's issue. review: hand off someone else's
   * claim (it stays theirs).
   */
  force?: boolean;
  /**
   * Checked on the loaded issue before the decision (e.g. the web API's
   * `If-Match`). The user is validated first.
   */
  precondition?: Precondition;
  /**
   * claim: take over someone else's claim only if it is stale (see
   * `staleClaim` in `src/core/stale.ts`); judged on the fresh scan under
   * the lock, so a claim renewed meanwhile is not taken. Your own stale
   * claim is renewed. unclaim: release someone else's claim only if it is
   * stale (else `already_claimed`, with the claim's age).
   */
  stale?: StaleOptions;
  /**
   * claim: if the issue is already your claim (active status), renew it:
   * write a newer `updated` (a heartbeat) instead of a no-op.
   */
  renew?: boolean;
}

/**
 * The stale claim of `issue` per `stale` (undefined without `stale`), for
 * claim / unclaim. A local closed issue never counts: taking it over would
 * reopen it.
 */
function staleClaimOf(
  issue: Issue,
  config: Config,
  elsewhere: Parameters<typeof staleClaim>[2],
  stale: StaleOptions | undefined,
): StaleClaim | undefined {
  if (!stale || isClosedStatus(config, issue.status)) return undefined;
  return staleClaim(issue, config, elsewhere, stale);
}

/**
 * Why a claim is not stale, for an `already_claimed` error when `stale` was
 * given: the claim's status is not the active status, or its age.
 */
function notStaleReason(
  issue: Issue,
  config: Config,
  elsewhere: Parameters<typeof staleClaim>[2],
  stale: StaleOptions,
): string {
  const { status } = effectiveState(issue, elsewhere);
  if (status !== activeStatus(config)) {
    return ` A claim in ${status} is never stale.`;
  }
  const age = claimAge(issue, elsewhere, stale.now);
  if (age === undefined) return ' Its last activity is unknown.';
  return ` Its last activity was ${formatDuration(age)} ago, less than ${formatDuration(stale.maxAgeMs)}.`;
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
 * `in_progress`); your own issue in the review status goes back to the
 * active status (rework). Throws `already_claimed` if someone else has it (here,
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
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const { issue } = stored;
    // Every worktree shares the repo lock, so a claim in another worktree
    // can't slip in between this scan and our write.
    const elsewhere = (await issueStatesElsewhere(ctx.dir, { ids: [id] })).get(
      id,
    );

    // Decided under the lock, on the freshly-read issue.
    const active = activeStatus(config);
    // A stale claim is taken over as with force (judged on this scan).
    const stale = staleClaimOf(issue, config, elsewhere, options.stale);
    const decision = decideClaim(issue, user, config, {
      force: options.force || stale !== undefined,
      elsewhere,
    });
    if (decision.action === 'already-claimed') {
      const where = decision.elsewhere;
      // The held status: active, or in review.
      const held = effectiveState(issue, elsewhere).status;
      const reason = options.stale
        ? notStaleReason(issue, config, elsewhere, options.stale)
        : '';
      throw new GitracError(
        'already_claimed',
        where
          ? `Issue #${id} is already claimed by ${where.assignee} (${held}) ${describeLocation(where)}.${reason}`
          : `Issue #${id} is already claimed by ${decision.assignee} (${held}).${reason}`,
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
    // Renew your own claim (a heartbeat), or a stale one of yours.
    const renewed =
      decision.action === 'noop' && (options.renew || stale !== undefined);
    if (decision.action === 'noop' && !renewed) {
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

    const verb = renewed && options.renew ? 'renew' : 'claim';
    const commit = await commitChange(ctx, config, {
      operation: 'claim',
      issue,
      paths,
      message: commitMessage(config, `${verb} #${id} ${issue.title}`),
    });
    const heldElsewhere =
      decision.action === 'claim' ? decision.heldElsewhere : undefined;
    return {
      changed: true,
      issue,
      paths,
      config,
      commit,
      ...(heldElsewhere ? { elsewhere: heldElsewhere } : {}),
      ...(stale ? { staleClaim: stale } : {}),
      ...(renewed && options.renew ? { renewed: true } : {}),
    };
  });
}

/**
 * Give an issue back: clear the assignee and move it from a held status
 * (the active status, default `in_progress`, or the review status) back to the unclaim status (`unclaimStatus`,
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
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const { issue } = stored;
    // Under the (shared) repo lock, like claim.
    const elsewhere = (await issueStatesElsewhere(ctx.dir, { ids: [id] })).get(
      id,
    );

    // A stale claim is released as with force (judged on this scan).
    const stale = staleClaimOf(issue, config, elsewhere, options.stale);
    const decision = decideUnclaim(issue, user, config, {
      force: options.force || stale !== undefined,
      elsewhere,
    });
    if (decision.action === 'not-yours') {
      const where = decision.elsewhere;
      const reason = options.stale
        ? notStaleReason(issue, config, elsewhere, options.stale)
        : '';
      throw new GitracError(
        'already_claimed',
        where
          ? `Issue #${id} is claimed by ${where.assignee} ${describeLocation(where)}, not you.${reason}`
          : `Issue #${id} is claimed by ${decision.assignee}, not you.${reason}`,
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
      ...(stale ? { staleClaim: stale } : {}),
    };
  });
}

/** `invalid_input`: the config has no review status. */
function noReviewStatus(): GitracError {
  return invalidInput(
    'No review status is configured: set reviewStatus to an open status in .issues/config.yaml',
  );
}

/**
 * Hand a claimed issue off for review: set the configured review status
 * (`reviewStatus`) and keep the assignee, so the issue stays held (others
 * need `force` to claim it, `next` skips it, other worktrees see it as
 * claimed) until it is closed or unclaimed. Judged by the effective state
 * (here, in other worktrees, or on other branches), like `unclaim`. Throws
 * `invalid_input` if no review status is configured, `invalid_state` if the
 * issue is not claimed, `already_claimed` if it is someone else's (unless
 * `force`; `details.claimedElsewhere` says where, if not here) and
 * `issue_closed` if it is closed here or in a newer version elsewhere. An
 * issue already in review is a no-op.
 */
export async function submitForReview(
  ctx: ServiceContext,
  id: number,
  options: ClaimOptions = {},
): Promise<ClaimResult> {
  const user = await ctx.identity();
  assertValidUser(user, options.comment, { claim: false });
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    // A config problem, checked before the issue is loaded.
    if (reviewStatus(config) === undefined) throw noReviewStatus();
    const stored = await loadStoredIssue(ctx.dir, id);
    const { issue } = stored;
    // Under the (shared) repo lock, like claim.
    const elsewhere = (await issueStatesElsewhere(ctx.dir, { ids: [id] })).get(
      id,
    );

    const decision = decideReview(issue, user, config, {
      force: options.force,
      elsewhere,
    });
    if (decision.action === 'no-review-status') throw noReviewStatus();
    if (decision.action === 'not-claimed') {
      throw new GitracError(
        'invalid_state',
        `Issue #${id} is not claimed (${decision.status}); only a claimed issue (${activeStatus(config)}, assigned) can go to review.`,
        { details: { id, status: decision.status } },
      );
    }
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
          ? `Issue #${id} is closed (${decision.status}) ${describeLocation(where)}.`
          : `Issue #${id} is closed (${decision.status}).`,
        {
          details: where
            ? { id, status: decision.status, closedElsewhere: where }
            : { id, status: decision.status },
        },
      );
    }
    if (decision.action === 'noop') {
      return { changed: false, issue, config };
    }

    issue.status = decision.status;
    issue.assignee = decision.assignee;
    // Strictly later than every version, so this one supersedes them.
    const now = nextTimestamp([
      issue.updated,
      ...(elsewhere ?? []).map((s) => s.updated),
    ]);
    issue.updated = now;
    addClaimComment(issue, user.name, options.comment, now);

    // The review status is open (config validation): write to the open dir.
    const paths = await relocateIssue(ctx.dir, issue, stored, {
      closed: false,
    });
    paths.push(...assetPaths(issue));

    const commit = await commitChange(ctx, config, {
      operation: 'review',
      issue,
      paths,
      message: commitMessage(config, `review #${id} ${issue.title}`),
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
