import { amendStrategy } from '../service/commit.ts';
import type { ServiceContext } from '../service/context.ts';
import { reloadConfig } from './live-config.ts';
import { serverIdentity } from './routes/identity.ts';
import type { ServerContext } from './server.ts';

/**
 * The service context for a web request: the server's default identity, the
 * live config (re-read into `ctx.config` under the lock) and amend-until-pushed
 * commits via the server's `AmendTracker`. Pushes after committing when
 * `config.git.autoPush` is set; once pushed, the commit is no longer
 * amendable, so the next edit starts a new commit (pushed history is never
 * rewritten). A failed push is logged, not reported as a failed request: the
 * change is already written and committed.
 */
export function webServiceContext(ctx: ServerContext): ServiceContext {
  return {
    dir: ctx.dir,
    identity: () => serverIdentity(ctx),
    loadConfig: () => reloadConfig(ctx),
    commit: amendStrategy(ctx.amendTracker),
    onPushError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`gitrac: push failed: ${message.trim()}`);
    },
  };
}
