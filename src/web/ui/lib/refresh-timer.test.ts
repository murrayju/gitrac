import { describe, expect, test } from 'bun:test';
import { createRefreshTimer } from './refresh-timer.ts';

/** Regression tests for #66: one shared periodic refresh per tab. */

function setup() {
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;
  let hidden = false;
  const visibility = new Set<() => void>();
  const timer = createRefreshTimer({
    intervalMs: 15_000,
    setInterval: (fn, ms) => {
      const id = nextId++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => intervals.delete(id as number),
    isHidden: () => hidden,
    onVisibilityChange: (fn) => {
      visibility.add(fn);
      return () => visibility.delete(fn);
    },
  });
  return {
    timer,
    intervals,
    visibility,
    tick() {
      for (const { fn } of [...intervals.values()]) fn();
    },
    setHidden(value: boolean) {
      hidden = value;
      for (const fn of [...visibility]) fn();
    },
  };
}

describe('createRefreshTimer', () => {
  test('all subscribers share one interval, running only while subscribed', () => {
    const { timer, intervals, visibility, tick } = setup();
    expect(timer.isRunning()).toBe(false);
    const calls: string[] = [];
    const offA = timer.subscribe(() => calls.push('a'));
    const offB = timer.subscribe(() => calls.push('b'));
    expect(intervals.size).toBe(1);
    expect([...intervals.values()][0]?.ms).toBe(15_000);
    tick();
    expect(calls).toEqual(['a', 'b']);
    offA();
    offA(); // idempotent
    expect(timer.subscriberCount()).toBe(1);
    expect(intervals.size).toBe(1);
    offB();
    expect(timer.isRunning()).toBe(false);
    expect(intervals.size).toBe(0);
    expect(visibility.size).toBe(0);
    // Restarts on the next subscriber.
    timer.subscribe(() => {});
    expect(intervals.size).toBe(1);
  });

  test('skips ticks while hidden and catches up once visible', () => {
    const { timer, tick, setHidden } = setup();
    let calls = 0;
    timer.subscribe(() => calls++);
    setHidden(true);
    tick();
    tick();
    expect(calls).toBe(0);
    setHidden(false);
    expect(calls).toBe(1);
    // Becoming visible without a missed tick doesn't refetch.
    setHidden(true);
    setHidden(false);
    expect(calls).toBe(1);
    tick();
    expect(calls).toBe(2);
  });

  test('a throwing listener does not stop the others', () => {
    const { timer, tick } = setup();
    const original = console.error;
    console.error = () => {};
    try {
      let calls = 0;
      timer.subscribe(() => {
        throw new Error('boom');
      });
      timer.subscribe(() => calls++);
      tick();
      expect(calls).toBe(1);
    } finally {
      console.error = original;
    }
  });
});
