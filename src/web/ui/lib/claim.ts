import { type ClaimUser, isAssignedTo } from '../../../core/claim.ts';
import type { Assignee } from '../../../core/types.ts';
import {
  activeStatus,
  isClosedStatus,
  type WorkflowConfig,
} from '../../../core/workflow.ts';
import { ApiError, type ApiIssue } from '../api.ts';
import { effectiveAuthor } from './identity.ts';

/**
 * Claim / Release in the issue sidebar (`POST /api/issues/:id/claim` and
 * `/unclaim`). The server decides; these helpers only choose which buttons
 * to show and how to show a refusal.
 */

/**
 * The user the UI acts as (the "Acting as" choice): the configured assignee
 * with the stored name (as the server resolves `author`), else the server's
 * identity. Null until the identity has loaded.
 */
export function actingUser(
  stored: string,
  identity: ClaimUser | null,
  assignees: Assignee[],
): ClaimUser | null {
  const name = effectiveAuthor(stored, identity?.name ?? null, assignees);
  if (name !== undefined) {
    const assignee = assignees.find((a) => a.name.trim() === name);
    if (assignee) return { name, email: assignee.email };
  }
  return identity;
}

/** Which claim buttons to show for an issue. */
export interface ClaimActions {
  /** "Claim": open, and not already the acting user's active claim. */
  claim: boolean;
  /** "Release": assigned to someone (the acting user or not). */
  release: boolean;
}

/**
 * The buttons for `issue` and `user`, judged by its effective state: a
 * claim in another worktree or on another branch (`claimedElsewhere`) counts
 * as the assignee. None for an issue that is closed (here, or in a newer
 * version elsewhere) or before the identity is known.
 */
export function claimActions(
  issue: Pick<
    ApiIssue,
    'status' | 'assignee' | 'claimedElsewhere' | 'closedElsewhere'
  >,
  user: ClaimUser | null,
  config: WorkflowConfig | null,
): ClaimActions {
  if (
    !user ||
    !config ||
    issue.closedElsewhere ||
    isClosedStatus(config, issue.status)
  ) {
    return { claim: false, release: false };
  }
  const elsewhere = issue.claimedElsewhere;
  const assignee = (elsewhere ? elsewhere.assignee : issue.assignee).trim();
  const active =
    elsewhere !== undefined || issue.status === activeStatus(config);
  const held = active && isAssignedTo(assignee, user);
  return { claim: !held, release: assignee !== '' };
}

/** A claim or release the server refused (409 `already_claimed` / `issue_closed`). */
export interface ClaimConflict {
  code: 'already_claimed' | 'issue_closed';
  /** The server's message (who holds it, and where). */
  message: string;
  /** Whether retrying with `force` can help (someone else holds it). */
  canForce: boolean;
}

/** The refusal in `err`, or null if it is another error. */
export function claimConflict(err: unknown): ClaimConflict | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  let body: unknown;
  try {
    body = JSON.parse(err.body);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const { code, error } = body as { code?: unknown; error?: unknown };
  if (code !== 'already_claimed' && code !== 'issue_closed') return null;
  return {
    code,
    message: typeof error === 'string' ? error : 'The request was refused',
    canForce: code === 'already_claimed',
  };
}
