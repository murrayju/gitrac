import type { ClaimUser } from '../core/claim.ts';
import { invalidInput } from '../core/errors.ts';
import { authorError } from '../core/validate.ts';
import { amendStrategy } from '../service/commit.ts';
import type { ServiceContext } from '../service/context.ts';
import { reloadConfig } from './live-config.ts';
import { serverIdentity } from './routes/identity.ts';
import type { ServerContext } from './server.ts';

export interface WebServiceOptions {
  /**
   * The identity picked in the UI ("Acting as"), from the request body. Set:
   * the acting user is the configured assignee with this name (see
   * {@link actingIdentity}). Unset: the server's identity.
   */
  author?: unknown;
}

/**
 * The service context for a web request: the server's default identity (or
 * the `author` picked in the UI), the live config (re-read into `ctx.config`
 * under the lock) and amend-until-pushed commits via the server's
 * `AmendTracker`. Pushes after committing when `config.git.autoPush` is set;
 * once pushed, the commit is no longer amendable, so the next edit starts a
 * new commit (pushed history is never rewritten). A failed push is logged,
 * not reported as a failed request: the change is already written and
 * committed.
 */
export function webServiceContext(
  ctx: ServerContext,
  options: WebServiceOptions = {},
): ServiceContext {
  const { author } = options;
  return {
    dir: ctx.dir,
    identity: () =>
      author === undefined ? serverIdentity(ctx) : actingIdentity(ctx, author),
    loadConfig: () => reloadConfig(ctx),
    commit: amendStrategy(ctx.amendTracker),
    onPushError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`gitrac: push failed: ${message.trim()}`);
    },
  };
}

/**
 * The user for an explicit `author` (e.g. who claims an issue): the first
 * configured assignee with that name (trimmed), with their email; else the
 * server's identity if it has that name. Reads `ctx.config`, which the
 * mutation lock re-reads from disk. Throws `invalid_input` if the name is not
 * a valid author (`authorError`) or matches no one.
 */
export async function actingIdentity(
  ctx: ServerContext,
  author: unknown,
): Promise<ClaimUser> {
  const error = authorError(author);
  if (error) throw invalidInput(error);
  const name = (author as string).trim();
  const assignee = ctx.config.assignees.find((a) => a.name.trim() === name);
  if (assignee) return { name: assignee.name.trim(), email: assignee.email };
  const server = await serverIdentity(ctx);
  if (server.name === name) return server;
  throw invalidInput(
    `Unknown author ${JSON.stringify(name)}: must be a configured assignee`,
  );
}
