import type { MiddlewareHandler } from 'hono';
import { LockTimeoutError } from '../fs/lock.ts';
import { withRepoLock } from '../git/lock.ts';
import { type ConfigHolder, reloadConfig } from './live-config.ts';

/**
 * Hono middleware that runs the rest of the request (the whole
 * read-modify-write-commit of a mutation) while holding the repo-wide gitrac
 * lock. Requests within this server are queued FIFO in-process; other gitrac
 * processes (CLI, other servers, other worktrees) are excluded via the
 * lockfile. Apply it to every route that writes issue/config files or commits.
 *
 * Once the lock is held, `ctx.config` is re-read from disk so the handler
 * sees any change another process made (e.g. `git.autoCommit`, new labels).
 *
 * Responds 503 if the lock can't be acquired in time.
 */
export function mutationLock(ctx: ConfigHolder): MiddlewareHandler {
  return async (c, next) => {
    try {
      await withRepoLock(ctx.dir, async () => {
        await reloadConfig(ctx);
        await next();
      });
    } catch (err) {
      if (err instanceof LockTimeoutError) {
        return c.json({ error: err.message }, 503);
      }
      throw err;
    }
  };
}
