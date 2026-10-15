/**
 * One shared server-sent-events connection for the whole tab.
 *
 * Browsers allow only ~6 concurrent HTTP/1.1 connections per host, and an
 * `EventSource` holds one open forever. Opening one per hook (or per list row)
 * starves every other request, so all subscribers share a single connection:
 * it opens on the first subscriber, reconnects on error, and closes once the
 * last subscriber has gone (after a short grace period, so a remount — React
 * StrictMode, route changes — doesn't churn the connection).
 */

/** The subset of `EventSource` this module uses (so tests can fake it). */
export interface EventSourceLike {
  addEventListener(type: string, listener: () => void): void;
  onerror: ((ev: Event) => unknown) | null;
  close(): void;
}

export interface EventStreamOptions {
  url: string;
  /** Server events that notify subscribers. */
  events: readonly string[];
  createEventSource: (url: string) => EventSourceLike;
  /** Delay before reconnecting after an error. */
  reconnectDelayMs?: number;
  /** Keep the connection open this long after the last unsubscribe. */
  idleCloseMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface EventStream {
  /** Register a listener; returns an unsubscribe function (idempotent). */
  subscribe(listener: () => void): () => void;
  subscriberCount(): number;
  /** Whether an `EventSource` is currently open (or connecting). */
  isOpen(): boolean;
}

export function createEventStream(options: EventStreamOptions): EventStream {
  const {
    url,
    events,
    createEventSource,
    reconnectDelayMs = 3000,
    idleCloseMs = 1000,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (handle) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;

  const listeners = new Set<() => void>();
  let source: EventSourceLike | null = null;
  let reconnectTimer: unknown = null;
  let idleTimer: unknown = null;

  function notify() {
    // Copy so listeners may (un)subscribe while being notified.
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (e) {
        console.error(e);
      }
    }
  }

  function connect() {
    reconnectTimer = null;
    const es = createEventSource(url);
    source = es;
    // The server sends `connected` on every (re)connect; subscribers refetch
    // then so changes made while disconnected are never missed.
    for (const type of events) {
      es.addEventListener(type, () => {
        if (source === es) notify();
      });
    }
    es.onerror = () => {
      if (source !== es) return;
      es.close();
      source = null;
      reconnectTimer = setTimer(connect, reconnectDelayMs);
    };
  }

  function disconnect() {
    idleTimer = null;
    if (reconnectTimer !== null) {
      clearTimer(reconnectTimer);
      reconnectTimer = null;
    }
    const es = source;
    source = null;
    es?.close();
  }

  return {
    subscribe(listener) {
      // A fresh function per subscription, so the same callback can be
      // subscribed twice and each unsubscribe only removes its own entry.
      const entry = () => listener();
      listeners.add(entry);
      if (idleTimer !== null) {
        clearTimer(idleTimer);
        idleTimer = null;
      }
      if (!source && reconnectTimer === null) connect();

      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(entry);
        if (listeners.size === 0 && idleTimer === null) {
          idleTimer = setTimer(disconnect, idleCloseMs);
        }
      };
    },
    subscriberCount: () => listeners.size,
    isOpen: () => source !== null,
  };
}

let shared: EventStream | null = null;

/** The tab-wide `/api/events` stream (created lazily). */
export function issueEvents(): EventStream {
  shared ??= createEventStream({
    url: '/api/events',
    events: ['connected', 'issues-changed'],
    createEventSource: (url) => new EventSource(url),
  });
  return shared;
}
