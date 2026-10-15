import { describe, expect, test } from 'bun:test';
import { createEventStream, type EventSourceLike } from './event-stream.ts';

class FakeEventSource implements EventSourceLike {
  listeners = new Map<string, (() => void)[]>();
  onerror: ((ev: Event) => unknown) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string) {
    for (const l of this.listeners.get(type) ?? []) l();
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
}

function setup() {
  const sources: FakeEventSource[] = [];
  let timers: { fn: () => void; ms: number; id: number }[] = [];
  let nextId = 1;
  const stream = createEventStream({
    url: '/api/events',
    events: ['connected', 'issues-changed'],
    createEventSource: (url) => {
      const es = new FakeEventSource(url);
      sources.push(es);
      return es;
    },
    reconnectDelayMs: 3000,
    idleCloseMs: 1000,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ fn, ms, id });
      return id;
    },
    clearTimer: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
  });
  /** Run (and drop) all pending timers with the given delay. */
  function runTimers(ms: number) {
    const due = timers.filter((t) => t.ms === ms);
    timers = timers.filter((t) => t.ms !== ms);
    for (const t of due) t.fn();
  }
  const open = () => sources.filter((s) => !s.closed);
  return { stream, sources, open, runTimers, pending: () => timers };
}

describe('createEventStream', () => {
  test('many subscribers share exactly one EventSource', () => {
    const { stream, sources } = setup();
    const unsubs = Array.from({ length: 15 }, () => stream.subscribe(() => {}));
    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toBe('/api/events');
    expect(stream.subscriberCount()).toBe(15);
    for (const u of unsubs) u();
    expect(stream.subscriberCount()).toBe(0);
  });

  test('connected and issues-changed notify every subscriber', () => {
    const { stream, sources } = setup();
    const calls: string[] = [];
    stream.subscribe(() => calls.push('a'));
    stream.subscribe(() => calls.push('b'));
    sources[0]?.emit('connected');
    sources[0]?.emit('issues-changed');
    sources[0]?.emit('something-else');
    expect(calls).toEqual(['a', 'b', 'a', 'b']);
  });

  test('unsubscribed listeners stop being notified; unsubscribe is idempotent', () => {
    const { stream, sources } = setup();
    const calls: string[] = [];
    const listener = () => calls.push('x');
    const u1 = stream.subscribe(listener);
    const u2 = stream.subscribe(listener);
    u1();
    u1();
    expect(stream.subscriberCount()).toBe(1);
    sources[0]?.emit('issues-changed');
    expect(calls).toEqual(['x']);
    u2();
    sources[0]?.emit('issues-changed');
    expect(calls).toEqual(['x']);
  });

  test('closes after the last unsubscribe (after the grace period)', () => {
    const { stream, sources, runTimers } = setup();
    const u = stream.subscribe(() => {});
    u();
    expect(sources[0]?.closed).toBe(false);
    runTimers(1000);
    expect(sources[0]?.closed).toBe(true);
    expect(stream.isOpen()).toBe(false);

    // A later subscriber opens a fresh connection.
    stream.subscribe(() => {});
    expect(sources).toHaveLength(2);
    expect(sources[1]?.closed).toBe(false);
  });

  test('resubscribing within the grace period reuses the connection', () => {
    const { stream, sources, runTimers, pending } = setup();
    stream.subscribe(() => {})();
    stream.subscribe(() => {});
    expect(pending()).toHaveLength(0);
    runTimers(1000);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.closed).toBe(false);
  });

  test('reconnects after an error and notifies on the new connected event', () => {
    const { stream, sources, open, runTimers } = setup();
    let calls = 0;
    stream.subscribe(() => calls++);
    stream.subscribe(() => calls++);
    sources[0]?.fail();
    expect(sources[0]?.closed).toBe(true);
    expect(open()).toHaveLength(0);

    // Subscribing while waiting to reconnect doesn't open a parallel one.
    stream.subscribe(() => calls++);
    expect(sources).toHaveLength(1);

    runTimers(3000);
    expect(sources).toHaveLength(2);
    expect(open()).toHaveLength(1);
    sources[1]?.emit('connected');
    expect(calls).toBe(3);

    // Events from the dead connection are ignored.
    sources[0]?.emit('issues-changed');
    expect(calls).toBe(3);
  });

  test('a pending reconnect is cancelled once everyone unsubscribes', () => {
    const { stream, sources, runTimers, pending } = setup();
    const u = stream.subscribe(() => {});
    sources[0]?.fail();
    u();
    runTimers(1000);
    expect(pending()).toHaveLength(0);
    runTimers(3000);
    expect(sources).toHaveLength(1);
    expect(stream.isOpen()).toBe(false);
  });

  test('a throwing listener does not block the others', () => {
    const { stream, sources } = setup();
    const orig = console.error;
    console.error = () => {};
    try {
      let called = false;
      stream.subscribe(() => {
        throw new Error('boom');
      });
      stream.subscribe(() => {
        called = true;
      });
      sources[0]?.emit('issues-changed');
      expect(called).toBe(true);
    } finally {
      console.error = orig;
    }
  });
});
