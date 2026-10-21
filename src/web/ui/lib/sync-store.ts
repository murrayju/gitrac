import type {
  SyncOperation,
  SyncResult,
  SyncStatus,
} from '../../../core/sync.ts';
import type { SyncResponse } from '../api.ts';
import type { RefreshTimer } from './refresh-timer.ts';
import { applyResult, reconcileProblems, type SyncProblem } from './sync.ts';
import { requestErrorReason } from './upload-error.ts';

/**
 * The tab-wide sync state (`SyncStatus.tsx`, `RemotesPanel.tsx`), shaped for
 * React's `useSyncExternalStore`. While someone is subscribed it:
 *
 * - loads the status (cheap, local refs only) at once, on each SSE event and
 *   on each tick of the shared `status` timer;
 * - fetches the included remotes once per page load and on each tick of the
 *   shared `fetch` timer (every few minutes, paused while the page is
 *   hidden).
 *
 * Problems (a conflict, local changes, an auth failure, ...) from an
 * operation stay until a later result or status shows they are resolved
 * (`reconcileProblems`), so the error state does not go away by itself.
 */

/** A user operation that is running. */
export interface SyncBusy {
  operation: SyncOperation;
  remote?: string;
}

export interface SyncStoreState {
  status: SyncStatus | null;
  /** The status could not be loaded. */
  statusError: string | null;
  /** The running user operation (not the background fetch). */
  busy: SyncBusy | null;
  /** True while the background fetch runs. */
  fetching: boolean;
  problems: SyncProblem[];
  /** The result of the last user operation. */
  lastResult: SyncResult | null;
  /** The last user operation failed as a whole (e.g. a merge in progress). */
  requestError: string | null;
}

export interface SyncStoreDeps {
  fetchStatus: () => Promise<SyncStatus>;
  run: (operation: SyncOperation, remote?: string) => Promise<SyncResponse>;
  setIncluded: (remote: string, included: boolean) => Promise<SyncStatus>;
  /** "Something changed" notifications (the shared SSE stream). */
  onChange: (listener: () => void) => () => void;
  /** Shared timer for status reloads. */
  statusTimer: RefreshTimer;
  /** Shared timer for background fetches. */
  fetchTimer: RefreshTimer;
}

export interface SyncStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SyncStoreState;
  /** Reload the status (no network). */
  refresh(): Promise<void>;
  /** Fetch the included remotes in the background. */
  backgroundFetch(): Promise<void>;
  /** Run a user operation; ignored while another one runs. */
  run(operation: SyncOperation, remote?: string): Promise<void>;
  setIncluded(remote: string, included: boolean): Promise<void>;
  /** Hide the last result and request error. */
  dismiss(): void;
}

export function createSyncStore(deps: SyncStoreDeps): SyncStore {
  let state: SyncStoreState = {
    status: null,
    statusError: null,
    busy: null,
    fetching: false,
    problems: [],
    lastResult: null,
    requestError: null,
  };
  const listeners = new Set<() => void>();
  let stops: (() => void)[] = [];
  let fetchedOnLoad = false;
  // A status only applies if no newer one (from a reload or an operation)
  // has been applied since its request started.
  let seq = 0;
  let pendingStatus: Promise<void> | null = null;

  function update(patch: Partial<SyncStoreState>) {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  function applyStatus(status: SyncStatus, result?: SyncResult) {
    seq++;
    const problems = result
      ? applyResult(state.problems, result)
      : state.problems;
    update({
      status,
      statusError: null,
      problems: reconcileProblems(problems, status),
    });
  }

  function refresh(): Promise<void> {
    if (pendingStatus) return pendingStatus;
    const mySeq = ++seq;
    pendingStatus = deps
      .fetchStatus()
      .then(
        (status) => {
          if (mySeq !== seq) return;
          update({
            status,
            statusError: null,
            problems: reconcileProblems(state.problems, status),
          });
        },
        (e: unknown) => {
          if (mySeq === seq) update({ statusError: requestErrorReason(e) });
        },
      )
      .finally(() => {
        pendingStatus = null;
      });
    return pendingStatus;
  }

  async function backgroundFetch(): Promise<void> {
    if (state.fetching || state.busy) return;
    update({ fetching: true });
    try {
      const { result, status } = await deps.run('fetch');
      applyStatus(status, result);
    } catch {
      // Shown by the next status load (or the next user operation).
    } finally {
      update({ fetching: false });
    }
  }

  async function run(operation: SyncOperation, remote?: string) {
    if (state.busy) return;
    update({
      busy: { operation, remote },
      requestError: null,
      lastResult: null,
    });
    try {
      const { result, status } = await deps.run(operation, remote);
      applyStatus(status, result);
      update({ lastResult: result });
    } catch (e) {
      update({ requestError: requestErrorReason(e) });
      void refresh();
    } finally {
      update({ busy: null });
    }
  }

  async function setIncluded(remote: string, included: boolean) {
    try {
      applyStatus(await deps.setIncluded(remote, included));
    } catch (e) {
      update({ requestError: requestErrorReason(e) });
    }
  }

  function start() {
    stops = [
      deps.onChange(() => void refresh()),
      deps.statusTimer.subscribe(() => void refresh()),
      deps.fetchTimer.subscribe(() => void backgroundFetch()),
    ];
    void refresh().then(() => {
      if (fetchedOnLoad) return;
      fetchedOnLoad = true;
      void backgroundFetch();
    });
  }

  function stop() {
    for (const s of stops) s();
    stops = [];
  }

  return {
    subscribe(listener) {
      const entry = () => listener();
      listeners.add(entry);
      if (listeners.size === 1) start();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(entry);
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot: () => state,
    refresh,
    backgroundFetch,
    run,
    setIncluded,
    dismiss: () => update({ lastResult: null, requestError: null }),
  };
}
