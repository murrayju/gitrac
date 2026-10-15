/**
 * A fetched resource shared by every component that reads it (e.g. the
 * project config), instead of each one fetching — and listening for changes —
 * on its own. Shaped for React's `useSyncExternalStore`.
 *
 * The first subscriber triggers a fetch and starts listening for change
 * notifications (refetching on each); the cached value survives after the
 * last subscriber leaves, so remounts render immediately.
 */

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface SharedQuery<T> {
  subscribe(listener: () => void): () => void;
  /** Stable snapshot; a new object only when something changed. */
  getSnapshot(): QueryState<T>;
  /** Fetch now (concurrent calls share one request). */
  refetch(): Promise<void>;
  /** Adopt a value obtained elsewhere (e.g. returned by a mutation). */
  set(data: T): void;
}

export function createSharedQuery<T>(
  fetcher: () => Promise<T>,
  /** Subscribe to "data may have changed"; returns an unsubscribe. */
  onChange?: (refetch: () => void) => () => void,
): SharedQuery<T> {
  let state: QueryState<T> = { data: null, loading: true, error: null };
  const listeners = new Set<() => void>();
  let inFlight: Promise<void> | null = null;
  let refetchQueued = false;
  // Each fetch/set bumps `seq`; a response only applies if nothing newer has.
  let seq = 0;
  let stopChanges: (() => void) | null = null;

  function update(patch: Partial<QueryState<T>>) {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  function refetch(): Promise<void> {
    if (inFlight) {
      // A change arrived mid-request: its response may predate the change,
      // so fetch once more when it finishes.
      refetchQueued = true;
      return inFlight;
    }
    const mySeq = ++seq;
    if (state.data === null && !state.loading) update({ loading: true });
    inFlight = fetcher()
      .then(
        (data) => {
          if (mySeq === seq) update({ data, loading: false, error: null });
        },
        (e: unknown) => {
          if (mySeq === seq)
            update({
              loading: false,
              error: e instanceof Error ? e.message : String(e),
            });
        },
      )
      .finally(() => {
        inFlight = null;
        if (refetchQueued && listeners.size > 0) {
          refetchQueued = false;
          void refetch();
        }
        refetchQueued = false;
      });
    return inFlight;
  }

  return {
    subscribe(listener) {
      const entry = () => listener();
      listeners.add(entry);
      if (listeners.size === 1) {
        stopChanges = onChange?.(() => void refetch()) ?? null;
        void refetch();
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(entry);
        if (listeners.size === 0) {
          stopChanges?.();
          stopChanges = null;
        }
      };
    },
    getSnapshot: () => state,
    refetch,
    set(data) {
      seq++;
      update({ data, loading: false, error: null });
    },
  };
}
