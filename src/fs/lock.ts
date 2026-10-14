import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import {
  link,
  readFile,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { hostname } from 'node:os';

/**
 * Cross-process + in-process mutual exclusion keyed by a lockfile path.
 *
 * - **In-process:** callers in the same process are queued FIFO per lock path,
 *   so only one of them ever competes for the lockfile at a time.
 * - **Cross-process:** the lock is a file created atomically (written to a
 *   unique temp file, then hard-linked into place, which fails if the lock
 *   already exists). Its JSON contents identify the holder.
 * - **Stale detection:** a lock is stale if its holder is on this host and its
 *   PID is no longer alive, or if its mtime is older than `staleMs`. Holders
 *   refresh the mtime periodically (heartbeat), so long-running holders are
 *   never mistaken for stale ones. Stale locks are broken under a secondary
 *   `<lock>.break` lock so two waiters can't both "break" and one of them
 *   delete a freshly-acquired lock.
 * - **Re-entrant:** a `withLock` call made while the current async context
 *   already holds the same lock runs immediately instead of deadlocking.
 *
 * Note: re-entrancy is tracked via AsyncLocalStorage, so fire-and-forget work
 * started inside a held lock will also be treated as holding it.
 */

export interface LockOptions {
  /** Max time to wait for the lockfile once at the front of the in-process queue. Default 120s. */
  timeoutMs?: number;
  /** A lock whose mtime is older than this is considered abandoned. Default 60s. */
  staleMs?: number;
  /** Initial retry delay while waiting. Default 10ms. */
  retryMinMs?: number;
  /** Max retry delay (exponential backoff with jitter). Default 200ms. */
  retryMaxMs?: number;
}

/** Contents of a lockfile. */
export interface LockInfo {
  pid: number;
  hostname: string;
  token: string;
  acquiredAt: string;
}

export class LockTimeoutError extends Error {
  readonly lockPath: string;
  readonly holder: LockInfo | null;
  constructor(lockPath: string, holder: LockInfo | null, timeoutMs: number) {
    const who = holder
      ? ` (held by pid ${holder.pid} on ${holder.hostname} since ${holder.acquiredAt})`
      : '';
    super(
      `Timed out after ${timeoutMs}ms waiting for lock ${lockPath}${who}. ` +
        'If no other gitrac process is running, delete the lock file.',
    );
    this.name = 'LockTimeoutError';
    this.lockPath = lockPath;
    this.holder = holder;
  }
}

const DEFAULTS = {
  timeoutMs: 120_000,
  staleMs: 60_000,
  retryMinMs: 10,
  retryMaxMs: 200,
} satisfies Required<LockOptions>;

/** How long a `.break` lock may exist before it is itself considered abandoned. */
const BREAK_STALE_MS = 10_000;

/** Lock paths held by the current async context (for re-entrancy). */
const heldInContext = new AsyncLocalStorage<ReadonlySet<string>>();
/** Tail of the in-process FIFO queue, per lock path. */
const queues = new Map<string, Promise<void>>();
/** Lockfiles this process currently owns: path -> token. */
const owned = new Map<string, string>();

let exitHandlerInstalled = false;
function installExitHandler(): void {
  if (exitHandlerInstalled) return;
  exitHandlerInstalled = true;
  // `process.exit()` inside a held lock skips `finally` blocks; clean up
  // synchronously so the next process doesn't have to wait for stale detection.
  process.on('exit', () => {
    for (const [path, token] of owned) {
      try {
        if (parseLockInfo(readFileSync(path, 'utf-8'))?.token === token) {
          unlinkSync(path);
        }
      } catch {
        // Best effort
      }
    }
    owned.clear();
  });
}

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

function parseLockInfo(content: string): LockInfo | null {
  try {
    const data = JSON.parse(content) as Partial<LockInfo>;
    if (
      typeof data.pid === 'number' &&
      typeof data.hostname === 'string' &&
      typeof data.token === 'string'
    ) {
      return {
        pid: data.pid,
        hostname: data.hostname,
        token: data.token,
        acquiredAt: String(data.acquiredAt ?? ''),
      };
    }
  } catch {
    // Fall through
  }
  return null;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else
    return errCode(err) === 'EPERM';
  }
}

/** Read the current lockfile, or null if it doesn't exist. */
async function readLock(
  lockPath: string,
): Promise<{ content: string; info: LockInfo | null; mtimeMs: number } | null> {
  try {
    const [st, content] = await Promise.all([
      stat(lockPath),
      readFile(lockPath, 'utf-8'),
    ]);
    return { content, info: parseLockInfo(content), mtimeMs: st.mtimeMs };
  } catch (err) {
    if (errCode(err) === 'ENOENT') return null;
    throw err;
  }
}

function isStale(
  lockPath: string,
  lock: { info: LockInfo | null; mtimeMs: number },
  staleMs: number,
): boolean {
  if (Date.now() - lock.mtimeMs > staleMs) return true;
  const { info } = lock;
  if (!info || info.hostname !== hostname()) return false;
  if (info.pid === process.pid) {
    // Our PID but not a lock we own: left behind by an earlier process that
    // had the same PID.
    return owned.get(lockPath) !== info.token;
  }
  return !isPidAlive(info.pid);
}

/** Atomically create `path` with `content`; returns false if it already exists. */
async function createExclusive(
  path: string,
  content: string,
): Promise<boolean> {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, content);
  try {
    await link(tmp, path);
    return true;
  } catch (err) {
    if (errCode(err) === 'EEXIST') return false;
    throw err;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

/**
 * Remove the lock if it is (still) stale. Returns true if the lock is gone,
 * meaning the caller should retry acquiring immediately.
 */
async function breakIfStale(
  lockPath: string,
  staleMs: number,
): Promise<boolean> {
  const seen = await readLock(lockPath);
  if (!seen) return true;
  if (!isStale(lockPath, seen, staleMs)) return false;

  const breakPath = `${lockPath}.break`;
  if (!(await createExclusive(breakPath, String(process.pid)))) {
    // Someone else is breaking it; clear an abandoned break lock if needed.
    try {
      const st = await stat(breakPath);
      if (Date.now() - st.mtimeMs > BREAK_STALE_MS) {
        await unlink(breakPath).catch(() => {});
      }
    } catch {
      // Gone already
    }
    return false;
  }
  try {
    // Re-check under the break lock: only remove the exact lock we judged stale.
    const current = await readLock(lockPath);
    if (!current) return true;
    if (current.content !== seen.content) return false;
    if (!isStale(lockPath, current, staleMs)) return false;
    await unlink(lockPath).catch(() => {});
    return true;
  } finally {
    await unlink(breakPath).catch(() => {});
  }
}

async function acquireFile(
  lockPath: string,
  opts: Required<LockOptions>,
): Promise<string> {
  const token = randomUUID();
  const info: LockInfo = {
    pid: process.pid,
    hostname: hostname(),
    token,
    acquiredAt: new Date().toISOString(),
  };
  const content = `${JSON.stringify(info)}\n`;
  const deadline = Date.now() + opts.timeoutMs;
  let delay = opts.retryMinMs;

  for (;;) {
    if (await createExclusive(lockPath, content)) {
      return token;
    }
    if (await breakIfStale(lockPath, opts.staleMs)) {
      continue;
    }
    if (Date.now() >= deadline) {
      const holder = (await readLock(lockPath).catch(() => null))?.info ?? null;
      throw new LockTimeoutError(lockPath, holder, opts.timeoutMs);
    }
    const jitter = Math.random() * delay;
    await Bun.sleep(
      Math.min(delay + jitter, Math.max(0, deadline - Date.now())),
    );
    delay = Math.min(delay * 2, opts.retryMaxMs);
  }
}

async function releaseFile(lockPath: string, token: string): Promise<void> {
  owned.delete(lockPath);
  // Only delete the lock if it is still ours (it may have been broken as
  // stale and re-acquired by someone else).
  const current = await readLock(lockPath).catch(() => null);
  if (current?.info?.token === token) {
    await unlink(lockPath).catch(() => {});
  }
}

/** True if the current async context holds the lock at `lockPath`. */
export function isLockHeld(lockPath: string): boolean {
  return heldInContext.getStore()?.has(lockPath) ?? false;
}

/**
 * Run `fn` while holding the lock at `lockPath` (see module docs). The lock is
 * released when `fn` settles, whether it resolves or throws.
 */
export async function withLock<T>(
  lockPath: string,
  fn: () => Promise<T> | T,
  options?: LockOptions,
): Promise<T> {
  if (isLockHeld(lockPath)) {
    return fn();
  }
  const opts = { ...DEFAULTS, ...options };

  // In-process FIFO queue: wait for every earlier caller to finish.
  const prev = queues.get(lockPath) ?? Promise.resolve();
  let done!: () => void;
  const mine = new Promise<void>((resolve) => {
    done = resolve;
  });
  const tail = prev.then(() => mine);
  queues.set(lockPath, tail);

  try {
    await prev;
    installExitHandler();
    const token = await acquireFile(lockPath, opts);
    owned.set(lockPath, token);
    const heartbeat = setInterval(
      () => {
        const now = new Date();
        utimes(lockPath, now, now).catch(() => {});
      },
      Math.max(1, Math.floor(opts.staleMs / 4)),
    );
    heartbeat.unref?.();
    try {
      const held = new Set(heldInContext.getStore() ?? []);
      held.add(lockPath);
      return await heldInContext.run(held, async () => await fn());
    } finally {
      clearInterval(heartbeat);
      await releaseFile(lockPath, token);
    }
  } finally {
    done();
    if (queues.get(lockPath) === tail) {
      queues.delete(lockPath);
    }
  }
}
