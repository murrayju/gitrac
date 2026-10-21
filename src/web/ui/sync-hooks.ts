import { useSyncExternalStore } from 'react';
import { fetchSyncStatus, runSyncOperation, setRemoteIncluded } from './api.ts';
import { issueEvents } from './lib/event-stream.ts';
import { elsewhereRefresh, syncFetchRefresh } from './lib/refresh-timer.ts';
import {
  createSyncStore,
  type SyncStore,
  type SyncStoreState,
} from './lib/sync-store.ts';

// One store for the tab: the sidebar indicator and the remotes view share
// its status, problems and timers. The status reloads on SSE events and on
// the shared 15s tick (commits from a terminal do not touch `.issues/`).
const store: SyncStore = createSyncStore({
  fetchStatus: fetchSyncStatus,
  run: runSyncOperation,
  setIncluded: setRemoteIncluded,
  onChange: (listener) => issueEvents().subscribe(listener),
  statusTimer: elsewhereRefresh(),
  fetchTimer: syncFetchRefresh(),
});

/** The shared sync state and its actions. */
export function useSync(): SyncStoreState & {
  actions: Omit<SyncStore, 'subscribe' | 'getSnapshot'>;
} {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...state, actions: store };
}
