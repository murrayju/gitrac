import type { Command } from 'commander';
import { GitracError, invalidInput } from '../../core/errors.ts';
import { authorError } from '../../core/validate.ts';
import { readConfig } from '../../fs/issue-store.ts';
import { getGlobalOptions, resolveProjectRoot } from '../global-options.ts';

export interface ServeOptions {
  dir: string;
  port: number;
  /** Interface to bind (default: 127.0.0.1, loopback only). */
  host: string;
  /** Default author for web changes (`--author`); '' = git config. */
  author?: string;
}

/**
 * Resolve the effective server options.
 *
 * `serve -p <port>` is owned by the `serve` subcommand. `--port <port>` is a
 * long-only program-level option (so bare `gitrac --port 4000` keeps working);
 * Commander consumes it at the program level even when written after `serve`.
 * The subcommand's value wins when both are present. `--host` works the same
 * way (long-only at both levels).
 *
 * The port is validated here from the raw option string (not
 * `GlobalOptions.port`, which is already `parseInt`ed and can't tell `abc`
 * from `NaN`), so the error echoes what the user typed (#85).
 */
export function resolveServeOptions(
  program: Command,
  serveCommand?: Command,
): ServeOptions {
  const globalOpts = getGlobalOptions(program);
  const local = serveCommand?.opts<{ port?: string; host?: string }>() ?? {};
  const globalPort = program.opts<{ port?: string }>().port;
  return {
    dir: globalOpts.dir,
    port: parsePort(local.port ?? globalPort ?? String(DEFAULT_PORT)),
    host: local.host ?? globalOpts.host,
    author: globalOpts.author,
  };
}

const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;

function invalidPort(value: string | number) {
  return invalidInput(
    `Invalid port "${value}": must be an integer from 0 to ${MAX_PORT}.`,
  );
}

/**
 * Parse a `--port` / `-p` value strictly: only plain decimal digits in
 * 0-65535 are accepted (no `4000abc`, `40.5`, `-1`, `0x10`, or blanks).
 * Throws an `invalid_input` error (exit 2) that echoes the original input.
 */
export function parsePort(value: string): number {
  const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port > MAX_PORT) throw invalidPort(value);
  return port;
}

/**
 * Start the web server, throwing a `GitracError` on failure. A bad port or
 * `--author` (see `authorError`) is `invalid_input`, before the project root
 * is resolved.
 */
export async function runServe(options: ServeOptions): Promise<void> {
  const { port, host } = options;
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw invalidPort(port);
  }
  // The server writes `--author` as `createdBy` and comment authors. Check it
  // now, so a bad name fails at startup and not on every write. A blank
  // value means git config (see `IdentityResolver`).
  const author = options.author?.trim();
  const error = author ? authorError(author) : null;
  if (error) throw invalidInput(error);
  const dir = await resolveProjectRoot(options.dir);
  const config = await readConfig(dir);
  // Load the web server only here. Other CLI commands then do not load Hono
  // and the web routes at startup.
  const { startServer } = await import('../../web/server.ts');
  try {
    await startServer({ dir, port, host, config, author: options.author });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new GitracError(
      'server_error',
      `Could not start server on ${host}:${port}: ${message}`,
      { cause: err },
    );
  }
}

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the web UI (default when no command is given)')
    .option('-p, --port <port>', 'Port for the web server (default: 3000)')
    .option(
      '--host <host>',
      'Interface to bind (default: 127.0.0.1; e.g. 0.0.0.0 for all — no auth!)',
    )
    .action(async (_options: unknown, cmd: Command) => {
      await runServe(resolveServeOptions(program, cmd));
    });
}
