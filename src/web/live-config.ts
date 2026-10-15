import type { MiddlewareHandler } from 'hono';
import type { Config } from '../core/types.ts';
import { readConfig } from '../fs/issue-store.ts';

/** The slice of the server context that holds the live config. */
export interface ConfigHolder {
  dir: string;
  config: Config;
}

/**
 * Re-read `.issues/config.yaml` into `ctx.config` and return it. The CLI (or
 * another server) may change it at any time — new assignees from `claim`,
 * label colors, `git.autoCommit` — so the server never trusts a copy cached
 * at startup. If the file can't be read or parsed (e.g. mid-edit), the last
 * good config is kept.
 */
export async function reloadConfig(ctx: ConfigHolder): Promise<Config> {
  try {
    ctx.config = await readConfig(ctx.dir);
  } catch {
    // Keep serving the last good config.
  }
  return ctx.config;
}

/**
 * Middleware that refreshes `ctx.config` before read-only requests
 * (GET/HEAD), so e.g. `GET /api/config` and `GET /api/git/status` reflect
 * the file on disk. Mutations refresh it inside the repo lock instead (see
 * `mutationLock`), so they can't race a concurrent writer.
 */
export function freshConfig(ctx: ConfigHolder): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') {
      await reloadConfig(ctx);
    }
    await next();
  };
}
