import { describe, expect, test } from 'bun:test';
import { createSharedQuery } from './shared-query.ts';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const requests: ReturnType<typeof deferred<string>>[] = [];
  const changeListeners = new Set<() => void>();
  const query = createSharedQuery(
    () => {
      const d = deferred<string>();
      requests.push(d);
      return d.promise;
    },
    (refetch) => {
      changeListeners.add(refetch);
      return () => changeListeners.delete(refetch);
    },
  );
  const change = () => {
    for (const l of changeListeners) l();
  };
  return { query, requests, changeListeners, change };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createSharedQuery', () => {
  test('many subscribers share one fetch and one change subscription', async () => {
    const { query, requests, changeListeners } = setup();
    const unsubs = Array.from({ length: 13 }, () => query.subscribe(() => {}));
    expect(requests).toHaveLength(1);
    expect(changeListeners.size).toBe(1);
    expect(query.getSnapshot()).toEqual({
      data: null,
      loading: true,
      error: null,
    });

    requests[0]?.resolve('cfg1');
    await tick();
    expect(query.getSnapshot()).toEqual({
      data: 'cfg1',
      loading: false,
      error: null,
    });

    for (const u of unsubs) u();
    expect(changeListeners.size).toBe(0);
  });

  test('snapshot is stable until something changes', async () => {
    const { query, requests } = setup();
    query.subscribe(() => {});
    const a = query.getSnapshot();
    expect(query.getSnapshot()).toBe(a);
    requests[0]?.resolve('x');
    await tick();
    expect(query.getSnapshot()).not.toBe(a);
  });

  test('refetches once per change notification and notifies subscribers', async () => {
    const { query, requests, change } = setup();
    let notified = 0;
    query.subscribe(() => notified++);
    query.subscribe(() => notified++);
    requests[0]?.resolve('v1');
    await tick();
    expect(notified).toBe(2);

    change();
    expect(requests).toHaveLength(2);
    requests[1]?.resolve('v2');
    await tick();
    expect(query.getSnapshot().data).toBe('v2');
  });

  test('a change during a fetch queues exactly one follow-up fetch', async () => {
    const { query, requests, change } = setup();
    query.subscribe(() => {});
    change();
    change();
    expect(requests).toHaveLength(1);
    requests[0]?.resolve('old');
    await tick();
    expect(requests).toHaveLength(2);
    requests[1]?.resolve('new');
    await tick();
    expect(requests).toHaveLength(2);
    expect(query.getSnapshot().data).toBe('new');
  });

  test('set() wins over an older in-flight response', async () => {
    const { query, requests } = setup();
    query.subscribe(() => {});
    query.set('from-mutation');
    requests[0]?.resolve('stale');
    await tick();
    expect(query.getSnapshot().data).toBe('from-mutation');
  });

  test('errors are reported and cleared by the next success', async () => {
    const { query, requests } = setup();
    query.subscribe(() => {});
    requests[0]?.reject(new Error('nope'));
    await tick();
    expect(query.getSnapshot()).toEqual({
      data: null,
      loading: false,
      error: 'nope',
    });
    void query.refetch();
    requests[1]?.resolve('ok');
    await tick();
    expect(query.getSnapshot()).toEqual({
      data: 'ok',
      loading: false,
      error: null,
    });
  });

  test('keeps the cached value across a remount and refreshes it', async () => {
    const { query, requests } = setup();
    const u = query.subscribe(() => {});
    requests[0]?.resolve('v1');
    await tick();
    u();
    query.subscribe(() => {});
    expect(query.getSnapshot().data).toBe('v1');
    expect(requests).toHaveLength(2);
  });
});
