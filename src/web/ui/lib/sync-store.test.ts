import { describe, expect, test } from 'bun:test';
import type {
  SyncOperation,
  SyncResult,
  SyncStatus,
} from '../../../core/sync.ts';
import type { SyncResponse } from '../api.ts';
import { createRefreshTimer } from './refresh-timer.ts';
import { createSyncStore } from './sync-store.ts';

function fakeTimer() {
  let tick: (() => void) | null = null;
  const timer = createRefreshTimer({
    intervalMs: 1000,
    setInterval: (fn) => {
      tick = fn;
      return 1;
    },
    clearInterval: () => {
      tick = null;
    },
    isHidden: () => false,
    onVisibilityChange: () => () => {},
  });
  return { timer, tick: () => tick?.(), running: () => tick !== null };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeStatus(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    branch: 'main',
    operation: null,
    remotes: [
      {
        name: 'origin',
        url: 'x',
        included: true,
        hasBranch: true,
        ahead: 1,
        behind: 1,
        toPush: { commits: [], more: 0 },
        toPull: { commits: [], more: 0 },
        conflicts: ['a.md'],
        lastFetch: null,
      },
    ],
    summary: { state: 'conflict', ahead: 1, behind: 1 },
    ...overrides,
  };
}

function setup() {
  const calls: string[] = [];
  let current = makeStatus();
  let runResult: SyncResult = {
    operation: 'fetch',
    branch: 'main',
    ok: true,
    remotes: [{ remote: 'origin', fetched: true }],
  };
  let changeListener: (() => void) | null = null;
  const statusTimer = fakeTimer();
  const fetchTimer = fakeTimer();
  const store = createSyncStore({
    fetchStatus: async () => {
      calls.push('status');
      return current;
    },
    run: async (operation: SyncOperation, remote?: string) => {
      calls.push(`${operation}${remote ? `:${remote}` : ''}`);
      return {
        result: { ...runResult, operation },
        status: current,
      } as SyncResponse;
    },
    setIncluded: async () => current,
    onChange: (listener) => {
      changeListener = listener;
      return () => {
        changeListener = null;
      };
    },
    statusTimer: statusTimer.timer,
    fetchTimer: fetchTimer.timer,
  });
  return {
    store,
    calls,
    statusTimer,
    fetchTimer,
    setStatus: (s: SyncStatus) => {
      current = s;
    },
    setRunResult: (r: SyncResult) => {
      runResult = r;
    },
    change: () => changeListener?.(),
  };
}

describe('createSyncStore', () => {
  test('loads the status, then fetches once on load', async () => {
    const t = setup();
    const stop = t.store.subscribe(() => {});
    await flush();
    await flush();
    expect(t.calls).toEqual(['status', 'fetch']);
    // A second subscriber (another component) does not fetch again.
    const stop2 = t.store.subscribe(() => {});
    stop();
    stop2();
    t.store.subscribe(() => {})();
    await flush();
    expect(t.calls.filter((c) => c === 'fetch')).toHaveLength(1);
  });

  test('timers and SSE drive reloads; they stop with the last subscriber', async () => {
    const t = setup();
    const stop = t.store.subscribe(() => {});
    await flush();
    await flush();
    t.calls.length = 0;
    t.change();
    await flush();
    t.statusTimer.tick();
    await flush();
    t.fetchTimer.tick();
    await flush();
    expect(t.calls).toEqual(['status', 'status', 'fetch']);
    stop();
    expect(t.statusTimer.running()).toBe(false);
    expect(t.fetchTimer.running()).toBe(false);
  });

  test('a conflict stays until the status shows it is resolved', async () => {
    const t = setup();
    t.store.subscribe(() => {});
    await flush();
    t.setRunResult({
      operation: 'sync',
      branch: 'main',
      ok: false,
      remotes: [
        {
          remote: 'origin',
          fetched: true,
          error: { kind: 'conflict', message: 'conflict', files: ['a.md'] },
        },
      ],
    });
    await t.store.run('sync');
    expect(t.store.getSnapshot().problems).toHaveLength(1);
    expect(t.store.getSnapshot().lastResult?.ok).toBe(false);
    // Still diverged with conflicts: the problem stays.
    await t.store.refresh();
    expect(t.store.getSnapshot().problems).toHaveLength(1);
    // Merged in a terminal: only ahead now.
    const [origin] = makeStatus().remotes;
    if (!origin) throw new Error('no remote');
    t.setStatus(
      makeStatus({
        remotes: [{ ...origin, ahead: 2, behind: 0, conflicts: null }],
        summary: { state: 'out-of-sync', ahead: 2, behind: 0 },
      }),
    );
    await t.store.refresh();
    expect(t.store.getSnapshot().problems).toEqual([]);
  });

  test('one user operation at a time; a request failure is shown', async () => {
    const t = setup();
    const store = createSyncStore({
      fetchStatus: async () => makeStatus(),
      run: async () => {
        throw new Error('A merge is in progress');
      },
      setIncluded: async () => makeStatus(),
      onChange: () => () => {},
      statusTimer: t.statusTimer.timer,
      fetchTimer: t.fetchTimer.timer,
    });
    const first = store.run('sync');
    expect(store.getSnapshot().busy).toEqual({
      operation: 'sync',
      remote: undefined,
    });
    await store.run('push', 'origin'); // ignored while busy
    await first;
    expect(store.getSnapshot().busy).toBeNull();
    expect(store.getSnapshot().requestError).toBe('A merge is in progress');
    store.dismiss();
    expect(store.getSnapshot().requestError).toBeNull();
  });
});
