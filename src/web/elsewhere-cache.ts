import type { ElsewhereMarks, IssueStateElsewhere } from '../core/elsewhere.ts';
import type { Issue } from '../core/types.ts';
import type { WorkflowConfig } from '../core/workflow.ts';
import { marksFromStates, scanElsewhere } from '../service/list.ts';

/**
 * How long a scan of other worktrees/branches (`issueStatesElsewhere`) is
 * reused by read-only API requests. Bounds how stale `claimedElsewhere` and
 * `closedElsewhere` in `GET /api/issues` / `GET /api/issues/:id` can be:
 * changes in other worktrees and to refs aren't watched, so they show up
 * within this long.
 */
export const ELSEWHERE_CACHE_TTL_MS = 5000;

type States = ReadonlyMap<number, readonly IssueStateElsewhere[]>;

export interface ElsewhereCacheOptions {
  /** Cache lifetime in ms (default: {@link ELSEWHERE_CACHE_TTL_MS}). */
  ttlMs?: number;
  /**
   * Change counter for this worktree's `.issues/` (`IssueWatcher.generation`);
   * a cached scan is dropped as soon as it moves.
   */
  generation?: () => number;
  /**
   * The scan (default: every issue, with their parsed issues, via
   * `scanElsewhere`).
   */
  scan?: (dir: string) => Promise<States>;
  now?: () => number;
}

interface Entry {
  states: Promise<States>;
  at: number;
  generation: number;
}

/**
 * Short-lived cache of the issue versions found on other branches and in
 * other worktrees, so list polling and SSE refetch bursts in the web server
 * share one scan (five git processes plus file reads) instead of running
 * one per request. Scans every issue (with the parsed issues, for
 * `GET /api/issues?elsewhere=1`), so the list and single-issue routes share
 * it; concurrent requests share an in-flight scan. Entries expire
 * after `ttlMs` or when this worktree's `.issues/` changes (file watcher).
 *
 * Read-only use only: mutations (e.g. claim) scan fresh, under the lock.
 */
export class ElsewhereCache {
  private entry: Entry | null = null;
  private readonly ttlMs: number;
  private readonly generation: () => number;
  private readonly scan: (dir: string) => Promise<States>;
  private readonly now: () => number;

  constructor(
    private readonly dir: string,
    options: ElsewhereCacheOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? ELSEWHERE_CACHE_TTL_MS;
    this.generation = options.generation ?? (() => 0);
    this.scan = options.scan ?? scanElsewhere;
    this.now = options.now ?? Date.now;
  }

  /** The versions elsewhere, by issue ID (cached; see the class doc). */
  states(): Promise<States> {
    const generation = this.generation();
    const now = this.now();
    const entry = this.entry;
    if (
      entry &&
      entry.generation === generation &&
      now - entry.at < this.ttlMs
    ) {
      return entry.states;
    }
    const states = this.scan(this.dir).catch((): States => {
      // Best effort (like the scan itself): don't cache a failure.
      if (this.entry?.states === states) this.entry = null;
      return new Map();
    });
    this.entry = { states, at: now, generation };
    return states;
  }

  /** Drop the cached scan. */
  invalidate(): void {
    this.entry = null;
  }

  /**
   * Which of `issues` are claimed or closed elsewhere, by ID
   * (`marksFromStates`).
   */
  async marks(
    issues: readonly Issue[],
    config: WorkflowConfig,
  ): Promise<Map<number, ElsewhereMarks>> {
    if (issues.length === 0) return new Map();
    return marksFromStates(issues, config, await this.states());
  }
}

/** The server's cache (created on first use, invalidated by its watcher). */
export function elsewhereCache(ctx: {
  dir: string;
  watcher: { generation(): number };
  elsewhere?: ElsewhereCache;
}): ElsewhereCache {
  ctx.elsewhere ??= new ElsewhereCache(ctx.dir, {
    generation: () => ctx.watcher.generation(),
  });
  return ctx.elsewhere;
}
