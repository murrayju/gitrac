import { describe, expect, test } from 'bun:test';
import { bindFirstFreePort, isAddressInUse } from './listen.ts';

function inUse(port: number): Error {
  return Object.assign(new Error(`Is port ${port} in use?`), {
    code: 'EADDRINUSE',
  });
}

/** A fake bind that fails for the busy ports and records every try. */
function fakeBind(busy: Set<number>) {
  const tried: number[] = [];
  const bind = (port: number) => {
    tried.push(port);
    if (busy.has(port)) throw inUse(port);
    return { port };
  };
  return { bind, tried };
}

describe('bindFirstFreePort (#118)', () => {
  test('uses the start port when it is free', () => {
    const { bind, tried } = fakeBind(new Set());
    expect(bindFirstFreePort(bind, 3000, 20)).toEqual({ port: 3000 });
    expect(tried).toEqual([3000]);
  });

  test('falls back to the next free port', () => {
    const { bind, tried } = fakeBind(new Set([3000, 3001]));
    expect(bindFirstFreePort(bind, 3000, 20)).toEqual({ port: 3002 });
    expect(tried).toEqual([3000, 3001, 3002]);
  });

  test('one attempt: a busy port fails and names the port', () => {
    const { bind, tried } = fakeBind(new Set([4000]));
    let error: unknown;
    try {
      bindFirstFreePort(bind, 4000, 1);
    } catch (err) {
      error = err;
    }
    expect(tried).toEqual([4000]);
    expect(isAddressInUse(error)).toBe(true);
    expect((error as Error).message).toBe('port 4000 is already in use');
  });

  test('stops after the given number of attempts', () => {
    const busy = new Set(Array.from({ length: 30 }, (_, i) => 3000 + i));
    const { bind, tried } = fakeBind(busy);
    expect(() => bindFirstFreePort(bind, 3000, 20)).toThrow(
      'ports 3000-3019 are all in use',
    );
    expect(tried).toHaveLength(20);
  });

  test('does not try past port 65535', () => {
    const { bind, tried } = fakeBind(new Set([65534, 65535]));
    expect(() => bindFirstFreePort(bind, 65534, 20)).toThrow(
      'ports 65534-65535 are all in use',
    );
    expect(tried).toEqual([65534, 65535]);
  });

  test('port 0 is tried once (the OS picks a free port)', () => {
    const { bind, tried } = fakeBind(new Set([0]));
    expect(() => bindFirstFreePort(bind, 0, 20)).toThrow(
      'port 0 is already in use',
    );
    expect(tried).toEqual([0]);
  });

  test('other bind errors are not retried', () => {
    const tried: number[] = [];
    const bind = (port: number) => {
      tried.push(port);
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    };
    expect(() => bindFirstFreePort(bind, 3000, 20)).toThrow('denied');
    expect(tried).toEqual([3000]);
  });

  test('detects EADDRINUSE from a real Bun.serve', () => {
    const fetch = () => new Response('ok');
    const first = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch });
    try {
      const busy = first.port as number;
      const second = bindFirstFreePort(
        (port) => Bun.serve({ hostname: '127.0.0.1', port, fetch }),
        busy,
        5,
      );
      try {
        expect(second.port).not.toBe(busy);
        expect(second.port).toBeGreaterThan(busy);
      } finally {
        second.stop(true);
      }
    } finally {
      first.stop(true);
    }
  });
});
