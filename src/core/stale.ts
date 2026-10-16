import { type IssueStateElsewhere, newestElsewhere } from './elsewhere.ts';
import { invalidInput } from './errors.ts';
import type { Issue } from './types.ts';
import { activeStatus, type WorkflowConfig } from './workflow.ts';

/**
 * Stale claims (pure; no I/O): a claim whose agent shows no activity for a
 * given time, e.g. because the agent crashed or hit a timeout.
 *
 * The signal is the `updated` of the issue's *effective* version (the
 * newest one here, in other worktrees or on branches; see
 * `src/core/elsewhere.ts`). Every gitrac write sets a newer `updated`, so
 * any activity on the issue (a comment, an edit, `claim --renew`) makes the
 * claim fresh again. Only a claim in the active status can be stale: a claim
 * in the review status waits on the reviewer, not on the agent.
 */

/** A stale claim: who holds it, its last activity, and where it is. */
export interface StaleClaim {
  assignee: string;
  /** The `updated` of the effective version (the last activity). */
  updated: string;
  /** Set when the effective version is on another branch or worktree. */
  ref?: string;
  /** Set when the effective version is in another worktree's working tree. */
  worktree?: string;
}

/** How old a claim must be to be stale, and the current time. */
export interface StaleOptions {
  /** Minimum time without activity, in ms. */
  maxAgeMs: number;
  /** The current time, in ms since the epoch. */
  now: number;
}

const UNIT_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
} as const;

/**
 * Parse a duration such as `30s`, `45m`, `2h` or `1d` (a positive integer
 * and one unit) into ms. Throws `invalid_input` for any other text.
 */
export function parseDuration(text: string): number {
  const match = /^(\d+)([smhd])$/.exec(text.trim());
  const amount = match ? Number.parseInt(match[1] ?? '', 10) : 0;
  if (!match || !(amount > 0) || !Number.isSafeInteger(amount)) {
    throw invalidInput(
      `Invalid duration "${text}": use a positive whole number and a unit (s, m, h or d), e.g. 30m or 2h.`,
    );
  }
  return amount * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}

/**
 * The {@link StaleOptions} for a `--stale <duration>` value (undefined if not
 * given). Throws `invalid_input` if the duration is invalid.
 */
export function staleOptions(
  duration: string | undefined,
  now: number = Date.now(),
): StaleOptions | undefined {
  return duration === undefined
    ? undefined
    : { maxAgeMs: parseDuration(duration), now };
}

/** A duration in ms as text, in its largest whole unit (`90m` -> `1h`). */
export function formatDuration(ms: number): string {
  for (const unit of ['d', 'h', 'm'] as const) {
    if (ms >= UNIT_MS[unit]) return `${Math.floor(ms / UNIT_MS[unit])}${unit}`;
  }
  return `${Math.max(0, Math.floor(ms / UNIT_MS.s))}s`;
}

/**
 * The age of the effective version of `issue` at `now`, in ms; undefined if
 * its `updated` can't be parsed.
 */
export function claimAge(
  issue: { updated?: string },
  states: readonly IssueStateElsewhere[] | undefined,
  now: number,
): number | undefined {
  const effective = newestElsewhere(issue, states) ?? issue;
  const at = Date.parse(effective.updated ?? '');
  return Number.isFinite(at) ? now - at : undefined;
}

/**
 * The stale claim of `issue`, if its effective version (the newest of the
 * local one and `states`) is a claim (the active status, and assigned) with
 * no activity for at least `maxAgeMs` before `now`. Else undefined: not
 * claimed, in the review status, fresh, or with an `updated` that can't be
 * parsed (a claim is never taken over when its age is unknown).
 */
export function staleClaim(
  issue: Pick<Issue, 'status' | 'assignee'> & { updated?: string },
  config: WorkflowConfig,
  states: readonly IssueStateElsewhere[] | undefined,
  options: StaleOptions,
): StaleClaim | undefined {
  const newer = newestElsewhere(issue, states);
  const effective = newer ?? issue;
  if (effective.status !== activeStatus(config)) return undefined;
  if (!effective.assignee.trim()) return undefined;
  const age = claimAge(issue, states, options.now);
  if (age === undefined || age < options.maxAgeMs) return undefined;
  const claim: StaleClaim = {
    assignee: effective.assignee,
    updated: effective.updated ?? '',
  };
  if (newer) {
    claim.ref = newer.ref;
    if (newer.worktree !== undefined) claim.worktree = newer.worktree;
  }
  return claim;
}
