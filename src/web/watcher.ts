import type { FSWatcher } from 'node:fs';
import { statSync, watch } from 'node:fs';
import { join } from 'node:path';

type ChangeListener = () => void;

/** How often to check `.issues/closed/` in case a watch event was lost. */
export const CLOSED_DIR_POLL_MS = 1000;

export interface IssueWatcherOptions {
  /** Interval for the `.issues/closed/` check (default `CLOSED_DIR_POLL_MS`). */
  pollMs?: number;
}

/** The `.issues/closed/` directory as last seen on disk. */
interface DirState {
  ino: number;
  mtimeMs: number;
}

/**
 * Watches .issues/ and .issues/closed/ directories for changes.
 * Emits 'change' events with debouncing.
 *
 * Git does not track empty directories, so `.issues/closed/` can be missing
 * at start, and can be created or removed at any time (first close, branch
 * checkout). Events on `.issues/` and a cheap periodic `stat` keep one
 * watcher on the current `.issues/closed/`.
 */
export class IssueWatcher {
  private dir: string;
  private started = false;
  private issuesWatcher: FSWatcher | null = null;
  private closedWatcher: FSWatcher | null = null;
  /** State of `.issues/closed/` at the last sync or poll (null: missing). */
  private closedState: DirState | null = null;
  /** True if the `.issues/closed/` watcher fired since the last poll. */
  private closedEventSeen = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<ChangeListener> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs = 100;
  private pollMs: number;
  private changes = 0;

  constructor(dir: string, options: IssueWatcherOptions = {}) {
    this.dir = dir;
    this.pollMs = options.pollMs ?? CLOSED_DIR_POLL_MS;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    try {
      const issuesDir = join(this.dir, '.issues');
      this.issuesWatcher = watch(issuesDir, { recursive: false }, (_, name) => {
        // An event for `closed` is its creation or removal. Always attach
        // a new watcher then: a new directory can get the inode of the old
        // one. The filename can be missing on some platforms.
        const file = name === null ? null : String(name);
        this.syncClosedWatcher(file === null || file === 'closed');
        this.recordChange();
      });
      this.issuesWatcher.on('error', () => {
        // The directory went away. Keep the server running.
      });
    } catch {
      // Directory may not exist
    }
    this.syncClosedWatcher();
    this.pollTimer = setInterval(() => this.pollClosedDir(), this.pollMs);
    this.pollTimer.unref?.();
  }

  stop(): void {
    this.started = false;
    this.issuesWatcher?.close();
    this.issuesWatcher = null;
    this.closeClosedWatcher();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  on(_event: 'change', listener: ChangeListener): void {
    this.listeners.add(listener);
  }

  off(_event: 'change', listener: ChangeListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Count of raw file-system events seen so far (not debounced): a cheap
   * "has anything changed since?" check for caches (see `ElsewhereCache`).
   */
  generation(): number {
    return this.changes;
  }

  /** Number of open directory watchers (`.issues/`, `.issues/closed/`). */
  watchedDirCount(): number {
    return (this.issuesWatcher ? 1 : 0) + (this.closedWatcher ? 1 : 0);
  }

  /** Number of registered change listeners (e.g. open SSE streams). */
  listenerCount(): number {
    return this.listeners.size;
  }

  private recordChange(): void {
    this.changes++;
    this.debounceEmit();
  }

  private closedDirState(): DirState | null {
    try {
      const stats = statSync(join(this.dir, '.issues', 'closed'));
      if (stats.isDirectory())
        return { ino: stats.ino, mtimeMs: stats.mtimeMs };
    } catch {
      // Directory does not exist (e.g., no closed issues yet)
    }
    return null;
  }

  /**
   * Make the `.issues/closed/` watcher match the disk. Attach a watcher if
   * the directory exists and has none. Replace the watcher if the directory
   * has a new inode, or if `force` is true. Close the watcher if the
   * directory does not exist. Only one watcher is open at a time.
   */
  private syncClosedWatcher(force = false): void {
    if (!this.started) return;
    const state = this.closedDirState();
    const sameDir =
      this.closedWatcher !== null &&
      state !== null &&
      this.closedState?.ino === state.ino;
    if (sameDir && !force) return;
    this.closeClosedWatcher();
    this.closedState = state;
    if (!state) return;
    try {
      const watcher = watch(
        join(this.dir, '.issues', 'closed'),
        { recursive: false },
        () => {
          this.closedEventSeen = true;
          // Some Bun versions report the removal of `closed/` only here,
          // not on the `.issues/` watcher. Check the directory again.
          this.syncClosedWatcher();
          this.recordChange();
        },
      );
      watcher.on('error', () => {
        // The directory went away. The next sync attaches a new watcher.
        if (this.closedWatcher === watcher) this.closeClosedWatcher();
      });
      this.closedWatcher = watcher;
    } catch {
      // Directory was removed again before the watch started
    }
  }

  private closeClosedWatcher(): void {
    this.closedWatcher?.close();
    this.closedWatcher = null;
  }

  /**
   * Find `.issues/closed/` changes that the watchers did not report. Bun
   * drops some events (for example, two events of the same type in the same
   * millisecond), and Bun before 1.4 on Linux gives no events for a watched
   * path that was deleted and created again. Record a change if the
   * directory appeared, went away, got a new inode, or got a new mtime
   * without a watcher event. The directory mtime changes when an entry is
   * added, removed or renamed. gitrac writes issue files that way (temp
   * file + rename), so the check finds those writes.
   */
  private pollClosedDir(): void {
    const state = this.closedDirState();
    const prev = this.closedState;
    if (state?.ino !== prev?.ino) {
      this.syncClosedWatcher(true);
      this.closedEventSeen = false;
      this.recordChange();
      return;
    }
    if (state && prev && state.mtimeMs !== prev.mtimeMs) {
      if (!this.closedEventSeen) this.recordChange();
      this.closedState = state;
    }
    this.closedEventSeen = false;
  }

  private debounceEmit(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      for (const listener of this.listeners) {
        try {
          listener();
        } catch {
          // Ignore listener errors
        }
      }
    }, this.debounceMs);
  }
}
