import { Hono } from 'hono';
import type { ClaimUser } from '../../core/claim.ts';
import { IdentityResolver } from '../../git/identity.ts';
import type { ServerContext } from '../server.ts';

/**
 * The server's default identity (from git config, or `--author`). Creates the
 * resolver on first use if the context wasn't given one.
 */
export function serverIdentity(ctx: ServerContext): Promise<ClaimUser> {
  ctx.identity ??= new IdentityResolver(ctx.dir);
  return ctx.identity.get();
}

export function identityRoutes(ctx: ServerContext): Hono {
  const app = new Hono();

  // GET /identity — who writes are attributed to by default
  app.get('/identity', async (c) => {
    const { name, email } = await serverIdentity(ctx);
    return c.json({ name, email });
  });

  return app;
}
