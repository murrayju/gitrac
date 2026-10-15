import type { Command } from 'commander';
import { readConfig } from '../../fs/issue-store.ts';
import { startServer } from '../../web/server.ts';
import {
  getGlobalOptions,
  resolveProjectRootOrExit,
} from '../global-options.ts';

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
 */
export function resolveServeOptions(
  program: Command,
  serveCommand?: Command,
): ServeOptions {
  const globalOpts = getGlobalOptions(program);
  const local = serveCommand?.opts<{ port?: string; host?: string }>() ?? {};
  return {
    dir: globalOpts.dir,
    port: local.port !== undefined ? parsePort(local.port) : globalOpts.port,
    host: local.host ?? globalOpts.host,
    author: globalOpts.author,
  };
}

function parsePort(value: string): number {
  return Number.parseInt(value, 10);
}

/** Start the web server, exiting with a helpful message on failure. */
export async function runServe(options: ServeOptions): Promise<void> {
  const { port, host } = options;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Error: Invalid port "${port}".`);
    process.exit(1);
  }
  const dir = await resolveProjectRootOrExit(options.dir);
  let config: Awaited<ReturnType<typeof readConfig>>;
  try {
    config = await readConfig(dir);
  } catch {
    console.error('Error: Could not start server. Is this a gitrac project?');
    console.error('Run "gitrac init" to initialize the .issues directory.');
    process.exit(1);
  }
  try {
    await startServer({ dir, port, host, config, author: options.author });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `Error: Could not start server on ${host}:${port}: ${message}`,
    );
    process.exit(1);
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
