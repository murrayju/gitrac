import type {
  CommitList,
  RemoteSyncError,
  RemoteSyncStatus,
  SyncErrorKind,
  SyncOperation,
  SyncResult,
  SyncStatus,
} from '../../../core/sync.ts';
import {
  conflictCommands,
  operationCommands,
  operationMessage,
} from '../../../core/sync.ts';

/**
 * UI rules for the sync indicator, its tooltip, the error banner and the
 * remotes view (pure; see `sync-store.ts` for the state).
 */

/** A failed step for one remote, kept until it is resolved. */
export interface SyncProblem {
  remote: string;
  operation: SyncOperation;
  error: RemoteSyncError;
}

/** Kinds that only a fix in a terminal resolves (red banner). */
const BLOCKING: ReadonlySet<SyncErrorKind> = new Set([
  'conflict',
  'local-changes',
]);

/** Kinds that a later fetch that works resolves. */
const NETWORK: ReadonlySet<SyncErrorKind> = new Set([
  'auth',
  'unreachable',
  'timeout',
]);

/**
 * The problems after an operation: each failed remote replaces its old
 * problem. A remote that worked clears its problems: all of them if it was
 * merged or pushed, only network problems if it was only fetched.
 */
export function applyResult(
  problems: readonly SyncProblem[],
  result: SyncResult,
): SyncProblem[] {
  const next = new Map(problems.map((p) => [p.remote, p]));
  for (const outcome of result.remotes) {
    const old = next.get(outcome.remote);
    if (outcome.error) {
      next.set(outcome.remote, {
        remote: outcome.remote,
        operation: result.operation,
        error: outcome.error,
      });
    } else if (outcome.integrated || outcome.pushed) {
      next.delete(outcome.remote);
    } else if (outcome.fetched && old && NETWORK.has(old.error.kind)) {
      next.delete(outcome.remote);
    }
  }
  return [...next.values()];
}

function diverged(remote: RemoteSyncStatus): boolean {
  return remote.ahead > 0 && remote.behind > 0;
}

/**
 * The problems that still apply for `status`: a problem goes away when its
 * remote is gone or in sync; a conflict also when the branch is no longer
 * diverged with conflicts; local changes when there is nothing to merge.
 */
export function reconcileProblems(
  problems: readonly SyncProblem[],
  status: SyncStatus,
): SyncProblem[] {
  const remotes = new Map(status.remotes.map((r) => [r.name, r]));
  return problems.filter(({ remote, error }) => {
    const r = remotes.get(remote);
    if (!r) return false;
    if (r.hasBranch && r.ahead === 0 && r.behind === 0) return false;
    if (error.kind === 'conflict') {
      return diverged(r) && (r.conflicts === null || r.conflicts.length > 0);
    }
    if (error.kind === 'local-changes') return r.behind > 0;
    return true;
  });
}

/** Up and down arrows with counts, e.g. `↑2 ↓1`. */
export function arrows(ahead: number, behind: number): string {
  const parts: string[] = [];
  if (ahead > 0) parts.push(`\u2191${ahead}`);
  if (behind > 0) parts.push(`\u2193${behind}`);
  return parts.join(' ');
}

export type IndicatorTone = 'ok' | 'pending' | 'warning' | 'error' | 'muted';

export interface Indicator {
  label: string;
  tone: IndicatorTone;
}

/** The compact indicator for the sidebar. */
export function indicator(
  status: SyncStatus | null,
  problems: readonly SyncProblem[],
): Indicator {
  if (!status) return { label: 'checking\u2026', tone: 'muted' };
  const { summary } = status;
  if (summary.state === 'operation') {
    return { label: `${status.operation} in progress`, tone: 'error' };
  }
  if (
    summary.state === 'conflict' ||
    problems.some((p) => BLOCKING.has(p.error.kind))
  ) {
    return { label: 'sync conflict', tone: 'error' };
  }
  const counts = arrows(summary.ahead, summary.behind);
  const tone: IndicatorTone = problems.length > 0 ? 'warning' : 'pending';
  switch (summary.state) {
    case 'detached':
      return { label: 'detached HEAD', tone: 'muted' };
    case 'no-remotes':
      return { label: 'no remotes', tone: 'muted' };
    case 'excluded':
      return { label: 'not synced', tone: 'muted' };
    case 'not-published':
      return {
        label: 'not synced',
        tone: problems.length ? 'warning' : 'pending',
      };
    case 'out-of-sync':
      return { label: counts, tone };
    default:
      return problems.length > 0
        ? { label: 'sync problem', tone: 'warning' }
        : { label: 'in sync', tone: 'ok' };
  }
}

/** Whether the simple sync button can do anything. */
export function canSync(status: SyncStatus | null): boolean {
  if (!status || status.operation || !status.branch) return false;
  return status.remotes.some((r) => r.included);
}

/** One remote's part of the tooltip. */
export interface TooltipSection {
  remote: string;
  /** e.g. `↑2 ↓1`, `in sync`, `no main on backup`. */
  heading: string;
  toPush: CommitList;
  toPull: CommitList;
  /** A problem or a predicted conflict, if any. */
  note: string | null;
}

/** The tooltip for the indicator: the included remotes. */
export function tooltipSections(
  status: SyncStatus,
  problems: readonly SyncProblem[],
): TooltipSection[] {
  const empty = { commits: [], more: 0 };
  return status.remotes
    .filter((r) => r.included)
    .map((r) => {
      const problem = problems.find((p) => p.remote === r.name);
      const conflict =
        r.conflicts && r.conflicts.length > 0
          ? `Merging would conflict in ${r.conflicts.join(', ')}`
          : null;
      const note = problem?.error.message ?? conflict;
      if (!r.hasBranch) {
        return {
          remote: r.name,
          heading: `no ${status.branch ?? 'branch'} on ${r.name}`,
          toPush: empty,
          toPull: empty,
          note,
        };
      }
      return {
        remote: r.name,
        heading: arrows(r.ahead, r.behind) || 'in sync',
        toPush: r.toPush,
        toPull: r.toPull,
        note,
      };
    });
}

/** The red banner: what is wrong and what to run in a terminal. */
export interface SyncBanner {
  title: string;
  message: string;
  commands: string[];
}

/**
 * The banner for a state that needs the terminal: a merge/rebase in
 * progress, a conflict (from a sync, or predicted by the status) or local
 * changes in the way. Null if there is none.
 */
export function syncBanner(
  status: SyncStatus | null,
  problems: readonly SyncProblem[],
): SyncBanner | null {
  if (status?.operation) {
    return {
      title: `A git ${status.operation} is in progress`,
      message: `${operationMessage(status.operation)} gitrac will not sync until then.`,
      commands: operationCommands(status.operation),
    };
  }
  const blocking = problems.find((p) => BLOCKING.has(p.error.kind));
  if (blocking) {
    return {
      title:
        blocking.error.kind === 'conflict'
          ? `Cannot sync with ${blocking.remote}: merge conflicts`
          : `Cannot sync with ${blocking.remote}: uncommitted changes`,
      message: blocking.error.message,
      commands: blocking.error.commands ?? [],
    };
  }
  const branch = status?.branch;
  const predicted = status?.remotes.find(
    (r) => r.included && r.hasBranch && (r.conflicts?.length ?? 0) > 0,
  );
  if (branch && predicted) {
    return {
      title: `${predicted.name}/${branch} has diverged with conflicts`,
      message: `Merging ${predicted.name}/${branch} would conflict in ${predicted.conflicts?.join(', ')}, so sync can not do it. Merge it in a terminal, resolve the conflicts and commit, then sync again.`,
      commands: conflictCommands(predicted.name, branch),
    };
  }
  return null;
}

/** "fetched 5m ago" style text for a fetch time (`now` for tests). */
export function fetchedAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never fetched';
  const seconds = Math.max(
    0,
    Math.floor((now - new Date(iso).getTime()) / 1000),
  );
  if (seconds < 60) return 'fetched just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `fetched ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `fetched ${hours}h ago`;
  return `fetched ${Math.floor(hours / 24)}d ago`;
}

/** A short text for what an operation did with one remote. */
export function outcomeText(outcome: SyncResult['remotes'][number]): string {
  if (outcome.error) return outcome.error.message;
  const parts: string[] = [];
  if (outcome.integrated === 'fast-forward') parts.push('fast-forwarded');
  if (outcome.integrated === 'merge') parts.push('merged');
  if (outcome.pushed === 'pushed') parts.push('pushed');
  if (outcome.pushed === 'created') parts.push('created the branch');
  if (outcome.skipped === 'no-branch') parts.push('skipped (no branch)');
  if (parts.length === 0) {
    parts.push(
      outcome.fetched && !outcome.integrated && !outcome.pushed
        ? 'fetched'
        : 'up to date',
    );
  }
  return parts.join(', ');
}
