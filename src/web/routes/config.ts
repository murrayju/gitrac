import { Hono } from 'hono';
import type { ServerContext } from '../server.ts';

export function configRoutes(ctx: ServerContext): Hono {
  const app = new Hono();

  app.get('/config', (c) => {
    return c.json(ctx.config);
  });

  return app;
}
