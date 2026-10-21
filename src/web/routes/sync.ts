import { type Context, Hono } from 'hono';
import { GitracError } from '../../core/errors.ts';
import type { SyncResult } from '../../core/sync.ts';
import type { ServiceContext } from '../../service/context.ts';
import {
  fetchRemotes,
  pullRemotes,
  pushRemotes,
  type SyncOptions,
  setSyncIncluded,
  syncRemotes,
  syncStatus,
} from '../../service/sync.ts';
import { mutationLock } from '../lock.ts';
import { asRecord, readJsonBody } from '../request-body.ts';
import type { ServerContext } from '../server.ts';
import { webServiceContext } from '../service-context.ts';

/**
 * Sync with git remotes (`src/service/sync.ts`):
 *
 * - `GET /git/sync`: the status of the current branch with every remote,
 *   from local refs only (no network).
 * - `POST /git/sync/fetch`, `/pull`, `/push`, `/sync`: body
 *   `{ remote? }`; without `remote`, the remotes included in the simple
 *   sync. 200 with `{ result, status }`; `result.ok` is false if a step
 *   failed for a remote (the per-remote errors are in `result.remotes`).
 * - `PUT /git/sync/remotes/:name`: body `{ included: boolean }`.
 *
 * Fetches take no lock; pull, push and sync hold the repo lock (with the
 * same FIFO queue as other web mutations) for the merge and push.
 */
export function syncRoutes(ctx: ServerContext): Hono {
  const app = new Hono();
  const locked = mutationLock(ctx);

  app.get('/git/sync', async (c) => c.json(await syncStatus(ctx.dir)));

  const operations: Record<
    string,
    (service: ServiceContext, options: SyncOptions) => Promise<SyncResult>
  > = {
    fetch: fetchRemotes,
    pull: pullRemotes,
    push: pushRemotes,
    sync: syncRemotes,
  };

  for (const [name, run] of Object.entries(operations)) {
    // `fetch` must not wait behind edits; the others lock inside the
    // service, only for the merge and push (the fetch runs first, unlocked).
    app.post(`/git/sync/${name}`, async (c) => {
      const body = asRecord(await readJsonBody(c));
      const { remote } = body;
      if (remote !== undefined && (typeof remote !== 'string' || !remote)) {
        return c.json({ error: '`remote` must be a remote name' }, 400);
      }
      return respond(c, async () => {
        const result = await run(webServiceContext(ctx), { remote });
        // Local commits changed: the next edit must not amend into them.
        const changed = result.remotes.some(
          (r) =>
            r.integrated === 'fast-forward' ||
            r.integrated === 'merge' ||
            r.pushed === 'pushed' ||
            r.pushed === 'created',
        );
        if (changed) {
          ctx.amendTracker.clear();
        }
        return { result, status: await syncStatus(ctx.dir) };
      });
    });
  }

  app.put('/git/sync/remotes/:name', locked, async (c) => {
    const { included } = asRecord(await readJsonBody(c));
    if (typeof included !== 'boolean') {
      return c.json({ error: '`included` must be true or false' }, 400);
    }
    return respond(c, () =>
      setSyncIncluded(webServiceContext(ctx), c.req.param('name'), included),
    );
  });

  return app;
}

/** Reply with `run()`'s value, mapping `GitracError`s to HTTP statuses. */
async function respond(
  c: Context,
  run: () => Promise<unknown>,
): Promise<Response> {
  try {
    return c.json(await run());
  } catch (err) {
    if (err instanceof GitracError) {
      const body = { error: err.message, code: err.code, ...err.details };
      switch (err.code) {
        case 'invalid_input':
          return c.json(body, 400);
        case 'not_found':
          return c.json(body, 404);
        case 'invalid_state':
          return c.json(body, 409);
        case 'lock_timeout':
          return c.json(body, 503);
      }
    }
    throw err;
  }
}
