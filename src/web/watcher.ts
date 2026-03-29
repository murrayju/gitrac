import type { FSWatcher } from 'node:fs';
import { watch } from 'node:fs';
import { join } from 'node:path';

type ChangeListener = () => void;

/**
 * Watches .issues/ and .issues/closed/ directories for changes.
 * Emits 'change' events with debouncing.
 */
export class IssueWatcher {
  private dir: string;
  private watchers: FSWatcher[] = [];
  private listeners: Set<ChangeListener> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs = 100;

  constructor(dir: string) {
    this.dir = dir;
  }

  start(): void {
    const issuesDir = join(this.dir, '.issues');
    const closedDir = join(this.dir, '.issues', 'closed');

    for (const watchDir of [issuesDir, closedDir]) {
      try {
        const watcher = watch(watchDir, { recursive: false }, () => {
          this.debounceEmit();
        });
        this.watchers.push(watcher);
      } catch {
        // Directory may not exist (e.g., no closed issues yet)
      }
    }
  }

  stop(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
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
