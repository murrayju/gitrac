import { amendStrategy } from '../service/commit.ts';
import { type ServiceContext, WEB_POLICY } from '../service/context.ts';
import { reloadConfig } from './live-config.ts';
import { serverIdentity } from './routes/identity.ts';
import type { ServerContext } from './server.ts';

/**
 * The service context for a web request: the server's default identity, the
 * live config (re-read into `ctx.config` under the lock), amend-until-pushed
 * commits via the server's `AmendTracker`, and never pushing.
 */
export function webServiceContext(ctx: ServerContext): ServiceContext {
  return {
    dir: ctx.dir,
    identity: () => serverIdentity(ctx),
    loadConfig: () => reloadConfig(ctx),
    push: false,
    commit: amendStrategy(ctx.amendTracker),
    policy: WEB_POLICY,
  };
}
