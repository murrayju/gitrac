import { type Context, Hono } from 'hono';
import { GitracError } from '../../core/errors.ts';
import {
  duplicateIssueIds,
  resolveDuplicateId,
} from '../../service/renumber.ts';
import { mutationLock } from '../lock.ts';
import { asRecord, readJsonBody } from '../request-body.ts';
import type { ServerContext } from '../server.ts';
import { webServiceContext } from '../service-context.ts';

const STATUS_BY_CODE = {
  invalid_input: 400,
  not_found: 404,
  invalid_state: 409,
  invalid_issue: 409,
  duplicate_issue: 409,
} as const;

/** Map a service error to `{ error, code, ...details }`, else rethrow (500). */
function duplicateError(c: Context, err: unknown): Response {
  if (err instanceof GitracError && err.code in STATUS_BY_CODE) {
    const status = STATUS_BY_CODE[err.code as keyof typeof STATUS_BY_CODE];
    return c.json(
      { ...(err.details ?? {}), error: err.message, code: err.code },
      status,
    );
  }
  throw err;
}

/**
 * Duplicate issue IDs (several files with one ID): `GET /duplicates` lists
 * them with the suggested fix, `POST /duplicates/:id/resolve` applies it.
 */
export function duplicateRoutes(ctx: ServerContext): Hono {
  const app = new Hono();
  const locked = mutationLock(ctx);

  app.get('/duplicates', async (c) => c.json(await duplicateIssueIds(ctx.dir)));

  // Body `{ keep? }`: the path of the file that keeps the ID (default: the
  // oldest). Every other file gets a fresh ID.
  app.post('/duplicates/:id/resolve', locked, async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }
    const { keep } = asRecord(await readJsonBody(c));
    try {
      const result = await resolveDuplicateId(webServiceContext(ctx), id, {
        keep: keep ?? undefined,
      });
      ctx.config = result.config;
      return c.json({
        id: result.id,
        kept: result.kept,
        renumbered: result.renumberings.map((r) => ({
          oldId: r.oldId,
          newId: r.newId,
          title: r.issue.title,
          from: r.from,
          to: r.to,
          references: r.references,
        })),
      });
    } catch (err) {
      return duplicateError(c, err);
    }
  });

  return app;
}
