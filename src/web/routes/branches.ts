import { type Context, Hono } from 'hono';
import { GitracError } from '../../core/errors.ts';
import { readBranchState } from '../../git/branches.ts';
import { switchBranch } from '../../service/branches.ts';
import { reloadConfig } from '../live-config.ts';
import { mutationLock } from '../lock.ts';
import { asRecord, readJsonBody } from '../request-body.ts';
import type { ServerContext } from '../server.ts';
import { webServiceContext } from '../service-context.ts';

/**
 * Map a branch error to its response: 400 for bad input, 409 for a switch
 * that the repo state refuses (or that git refuses), else rethrow (500).
 */
function branchError(c: Context, err: unknown): Response {
  if (err instanceof GitracError) {
    if (err.code === 'invalid_input') {
      return c.json({ error: err.message, code: err.code }, 400);
    }
    if (err.code === 'invalid_state' || err.code === 'git_error') {
      return c.json(
        { error: err.message, code: err.code, ...(err.details ?? {}) },
        409,
      );
    }
  }
  throw err;
}

/**
 * The branch indicator and switcher: `GET /git/branches` (the branch state,
 * see `BranchState` in `src/core/branches.ts`) and `POST /git/switch`
 * (`{ branch }`, a local branch).
 */
export function branchRoutes(ctx: ServerContext): Hono {
  const app = new Hono();
  const locked = mutationLock(ctx);

  app.get('/git/branches', async (c) => c.json(await readBranchState(ctx.dir)));

  app.post('/git/switch', locked, async (c) => {
    const { branch } = asRecord(await readJsonBody(c));
    try {
      const result = await switchBranch(webServiceContext(ctx), branch);
      if (result.switched) {
        // The amendable commit, the scan of other branches and the config
        // belong to the branch checked out before.
        ctx.amendTracker.clear();
        ctx.elsewhere?.invalidate();
        await reloadConfig(ctx);
      }
      return c.json(result);
    } catch (err) {
      return branchError(c, err);
    }
  });

  return app;
}
