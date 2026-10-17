import { describe, expect, test } from 'bun:test';
import { ApiError } from '../api.ts';
import { createSaveQueue } from './save-queue.ts';

function recorder() {
  const log: string[] = [];
  return {
    log,
    setters: {
      setBusy: (busy: boolean) => log.push(`busy ${busy}`),
      setError: (error: string | null) => log.push(`error ${error}`),
    },
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createSaveQueue', () => {
  test('a failed save shows the field and the reason, and does not reject (#112)', async () => {
    const { log, setters } = recorder();
    const queue = createSaveQueue(setters);
    const ok = await queue.run('status', async () => {
      throw new ApiError(400, JSON.stringify({ error: 'Invalid status' }));
    });
    expect(ok).toBe(false);
    expect(log).toEqual([
      'busy true',
      'error null',
      'error Failed to save status: Invalid status',
      'busy false',
    ]);
  });

  test('a second pick waits for the first save, and busy stays on until both settle', async () => {
    const { log, setters } = recorder();
    const queue = createSaveQueue(setters);
    const first = deferred();
    const order: string[] = [];
    const a = queue.run('status', async () => {
      order.push('start a');
      await first.promise;
      order.push('end a');
    });
    const b = queue.run('status', async () => {
      order.push('start b');
    });
    await tick();
    expect(order).toEqual(['start a']);
    first.resolve();
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(order).toEqual(['start a', 'end a', 'start b']);
    expect(log.filter((l) => l.startsWith('busy'))).toEqual([
      'busy true',
      'busy true',
      'busy false',
    ]);
  });

  test('a failed save does not stop the next one', async () => {
    const { log, setters } = recorder();
    const queue = createSaveQueue(setters);
    const first = deferred();
    const a = queue.run('priority', () => first.promise);
    let ranB = false;
    const b = queue.run('assignee', async () => {
      ranB = true;
    });
    first.reject(new TypeError('Failed to fetch'));
    expect(await a).toBe(false);
    expect(await b).toBe(true);
    expect(ranB).toBe(true);
    expect(log).toContain(
      'error Failed to save priority: Network error: could not reach the server',
    );
    expect(log.at(-1)).toBe('busy false');
  });

  test('a new pick clears the last error', async () => {
    const { log, setters } = recorder();
    const queue = createSaveQueue(setters);
    await queue.run('status', async () => {
      throw new Error('boom');
    });
    log.length = 0;
    await queue.run('status', async () => {});
    expect(log).toEqual(['busy true', 'error null', 'busy false']);
  });
});
