/**
 * One shared periodic "refetch now" tick for the whole tab.
 *
 * Changes in this worktree arrive over SSE, but claims made in other
 * worktrees or on other branches (`claimedElsewhere`) aren't watched by the
 * server, so views showing them also refetch on this tick. All subscribers
 * share a single interval, running only while someone is subscribed; ticks
 * are skipped while the page is hidden, and one fires as soon as it is
 * visible again if any were skipped.
 */

export interface RefreshTimerOptions {
  intervalMs: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /** Whether the page is hidden (default: `document.hidden`, else false). */
  isHidden?: () => boolean;
  /**
   * Subscribe to page visibility changes; returns an unsubscribe (default:
   * `visibilitychange` on `document`, if any).
   */
  onVisibilityChange?: (fn: () => void) => () => void;
}

export interface RefreshTimer {
  /** Register a listener; returns an unsubscribe function (idempotent). */
  subscribe(listener: () => void): () => void;
  subscriberCount(): number;
  /** Whether the interval is currently running. */
  isRunning(): boolean;
}

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

function onDocumentVisibility(fn: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  document.addEventListener('visibilitychange', fn);
  return () => document.removeEventListener('visibilitychange', fn);
}

export function createRefreshTimer(options: RefreshTimerOptions): RefreshTimer {
  const {
    intervalMs,
    setInterval: set = (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: clear = (handle) =>
      globalThis.clearInterval(
        handle as ReturnType<typeof globalThis.setInterval>,
      ),
    isHidden = documentHidden,
    onVisibilityChange = onDocumentVisibility,
  } = options;

  const listeners = new Set<() => void>();
  let interval: unknown = null;
  let stopVisibility: (() => void) | null = null;
  let missed = false;

  function notify() {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (e) {
        console.error(e);
      }
    }
  }

  function tick() {
    if (isHidden()) {
      missed = true;
      return;
    }
    notify();
  }

  function visibilityChanged() {
    if (missed && !isHidden()) {
      missed = false;
      notify();
    }
  }

  function start() {
    interval = set(tick, intervalMs);
    stopVisibility = onVisibilityChange(visibilityChanged);
  }

  function stop() {
    if (interval !== null) clear(interval);
    interval = null;
    stopVisibility?.();
    stopVisibility = null;
    missed = false;
  }

  return {
    subscribe(listener) {
      const entry = () => listener();
      listeners.add(entry);
      if (interval === null) start();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(entry);
        if (listeners.size === 0) stop();
      };
    },
    subscriberCount: () => listeners.size,
    isRunning: () => interval !== null,
  };
}

/**
 * How often views refetch to pick up claims made in other worktrees or on
 * other branches. With the server's cache (`ELSEWHERE_CACHE_TTL_MS`, 5s),
 * the UI shows such a claim within about 20s.
 */
export const ELSEWHERE_REFRESH_MS = 15_000;

let shared: RefreshTimer | null = null;

/** The tab-wide periodic refresh (created lazily). */
export function elsewhereRefresh(): RefreshTimer {
  shared ??= createRefreshTimer({ intervalMs: ELSEWHERE_REFRESH_MS });
  return shared;
}
