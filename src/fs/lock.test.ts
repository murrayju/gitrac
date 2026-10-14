import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isLockHeld,
  type LockInfo,
  LockTimeoutError,
  withLock,
} from './lock.ts';

const FIXTURE = join(import.meta.dir, 'lock.fixture.ts');

let dir: string;
let lockPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-lock-test-'));
  lockPath = join(dir, 'test.lock');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function spawnFixture(...args: string[]) {
  return Bun.spawn([process.execPath, FIXTURE, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

/** Resolve once the child prints "acquired" (i.e. it holds the lock). */
async function waitForAcquired(
  child: ReturnType<typeof spawnFixture>,
): Promise<void> {
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (!out.includes('acquired')) {
    const { value, done } = await reader.read();
    if (done) {
      throw new Error(
        `child exited before acquiring: ${await new Response(child.stderr).text()}`,
      );
    }
    out += decoder.decode(value);
  }
  reader.releaseLock();
}

async function writeLockFile(
  info: Partial<LockInfo>,
  ageMs = 0,
): Promise<void> {
  await writeFile(
    lockPath,
    JSON.stringify({
      pid: 1,
      hostname: hostname(),
      token: 'foreign',
      acquiredAt: new Date().toISOString(),
      ...info,
    }),
  );
  if (ageMs) {
    const past = new Date(Date.now() - ageMs);
    await utimes(lockPath, past, past);
  }
}

async function deadPid(): Promise<number> {
  const child = Bun.spawn([process.execPath, '--version'], {
    stdout: 'ignore',
  });
  await child.exited;
  return child.pid;
}

describe('withLock (in-process)', () => {
  test('returns the callback result and removes the lockfile', async () => {
    const result = await withLock(lockPath, async () => {
      expect(await Bun.file(lockPath).exists()).toBe(true);
      return 42;
    });
    expect(result).toBe(42);
    expect(await Bun.file(lockPath).exists()).toBe(false);
  });

  test('serializes concurrent callers in FIFO order', async () => {
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        withLock(lockPath, async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await Bun.sleep(2);
          order.push(i);
          active--;
        }),
      ),
    );
    expect(maxActive).toBe(1);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('releases the lock when the callback throws', async () => {
    await expect(
      withLock(lockPath, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await Bun.file(lockPath).exists()).toBe(false);
    // And the queue is not wedged
    expect(await withLock(lockPath, () => 'ok')).toBe('ok');
  });

  test('is re-entrant within the same async context', async () => {
    const result = await withLock(lockPath, async () => {
      expect(isLockHeld(lockPath)).toBe(true);
      return withLock(lockPath, async () => 'nested', { timeoutMs: 50 });
    });
    expect(result).toBe('nested');
    expect(isLockHeld(lockPath)).toBe(false);
  });

  test('does not delete a lock that was taken over by someone else', async () => {
    await withLock(lockPath, async () => {
      await writeLockFile({ token: 'someone-else' });
    });
    expect(await Bun.file(lockPath).exists()).toBe(true);
  });
});

describe('withLock (stale detection)', () => {
  test('breaks a lock whose holder PID is dead (same host)', async () => {
    await writeLockFile({ pid: await deadPid() });
    expect(await withLock(lockPath, () => 'ok', { timeoutMs: 2000 })).toBe(
      'ok',
    );
  });

  test('breaks a lock older than staleMs even if the PID looks alive', async () => {
    await writeLockFile({ pid: process.ppid, hostname: 'other-host' }, 5_000);
    expect(
      await withLock(lockPath, () => 'ok', { timeoutMs: 2000, staleMs: 1000 }),
    ).toBe('ok');
  });

  test('waits for, then times out on, a live fresh lock', async () => {
    await writeLockFile({ pid: process.ppid });
    const err = await withLock(lockPath, () => 'never', {
      timeoutMs: 150,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    expect((err as LockTimeoutError).holder?.pid).toBe(process.ppid);
    // The foreign lock was left alone
    const info = JSON.parse(await readFile(lockPath, 'utf-8')) as LockInfo;
    expect(info.token).toBe('foreign');
  });

  test('never treats a lock from another host as dead by PID', async () => {
    await writeLockFile({ pid: await deadPid(), hostname: 'other-host' });
    await expect(
      withLock(lockPath, () => 'never', { timeoutMs: 150 }),
    ).rejects.toBeInstanceOf(LockTimeoutError);
  });
});

describe('withLock (cross-process)', () => {
  test('parallel processes never interleave critical sections', async () => {
    const counter = join(dir, 'counter');
    await writeFile(counter, '0');
    const procs = 4;
    const times = 15;
    const children = Array.from({ length: procs }, () =>
      spawnFixture('increment', lockPath, counter, String(times)),
    );
    const codes = await Promise.all(children.map((c) => c.exited));
    expect(codes).toEqual(Array(procs).fill(0));
    // A lost update (two holders at once) would make this smaller
    expect(Number(await readFile(counter, 'utf-8'))).toBe(procs * times);
    expect(await Bun.file(lockPath).exists()).toBe(false);
  }, 30_000);

  test('a long-running holder is not considered stale (heartbeat)', async () => {
    const marker = join(dir, 'released');
    // Holds for 4x staleMs; without the heartbeat the lock would look stale.
    const child = spawnFixture('hold', lockPath, marker, '800', '200');
    await waitForAcquired(child);
    await withLock(
      lockPath,
      async () => {
        expect(await Bun.file(marker).exists()).toBe(true);
      },
      { staleMs: 200, timeoutMs: 10_000 },
    );
    expect(await child.exited).toBe(0);
  }, 30_000);

  test('process.exit() while holding the lock removes the lockfile', async () => {
    const child = spawnFixture('exit-inside', lockPath);
    expect(await child.exited).toBe(3);
    expect(await Bun.file(lockPath).exists()).toBe(false);
  });

  test('a killed holder (no cleanup) is detected as stale', async () => {
    const marker = join(dir, 'released');
    const child = spawnFixture('hold', lockPath, marker, '60000', '60000');
    await waitForAcquired(child);
    child.kill('SIGKILL');
    await child.exited;
    expect(await Bun.file(lockPath).exists()).toBe(true);
    expect(await withLock(lockPath, () => 'ok', { timeoutMs: 5000 })).toBe(
      'ok',
    );
  }, 30_000);
});
