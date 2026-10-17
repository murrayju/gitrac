import { type Context, Hono } from 'hono';
import { GitracError } from '../../core/errors.ts';
import {
  type ConfigChange,
  updateAssignees,
  updateLabelColors,
} from '../../service/config.ts';
import { mutationLock } from '../lock.ts';
import { asRecord, readJsonBody } from '../request-body.ts';
import type { ServerContext } from '../server.ts';
import { webServiceContext } from '../service-context.ts';

export function configRoutes(ctx: ServerContext): Hono {
  const app = new Hono();
  // Serialize every mutation (in-process queue + cross-process lockfile)
  const locked = mutationLock(ctx);

  /** Run a config mutation; reply with the new config, or 400 on bad input. */
  async function mutateConfig(
    c: Context,
    run: () => Promise<ConfigChange>,
  ): Promise<Response> {
    try {
      const result = await run();
      // Update the in-memory config
      ctx.config = result.config;
      return c.json(result.config);
    } catch (err) {
      if (err instanceof GitracError && err.code === 'invalid_input') {
        // Several messages (e.g. one per bad assignee) also go in `errors`.
        const errors = err.details?.errors;
        return c.json(
          Array.isArray(errors)
            ? { error: err.message, errors }
            : { error: err.message },
          400,
        );
      }
      throw err;
    }
  }

  app.get('/config', (c) => {
    return c.json(ctx.config);
  });

  // PATCH /config/labels — update label colors
  app.patch('/config/labels', locked, async (c) => {
    // A non-JSON / non-object body leaves `labels` undefined -> 400.
    const { labels } = asRecord(await readJsonBody(c));
    return mutateConfig(c, () =>
      updateLabelColors(webServiceContext(ctx), labels),
    );
  });

  // PATCH /config/assignees — update assignees list
  app.patch('/config/assignees', locked, async (c) => {
    const { assignees } = asRecord(await readJsonBody(c));
    return mutateConfig(c, () =>
      updateAssignees(webServiceContext(ctx), assignees),
    );
  });

  return app;
}
