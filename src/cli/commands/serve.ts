import type { Command } from 'commander';
import { readConfig } from '../../fs/issue-store.ts';
import { startServer } from '../../web/server.ts';
import { getGlobalOptions } from '../global-options.ts';

export interface ServeOptions {
  dir: string;
  port: number;
}

/**
 * Resolve the effective server options.
 *
 * `serve -p <port>` is owned by the `serve` subcommand. `--port <port>` is a
 * long-only program-level option (so bare `gitrac --port 4000` keeps working);
 * Commander consumes it at the program level even when written after `serve`.
 * The subcommand's value wins when both are present.
 */
export function resolveServeOptions(
  program: Command,
  serveCommand?: Command,
): ServeOptions {
  const globalOpts = getGlobalOptions(program);
  const localPort = serveCommand?.opts<{ port?: string }>().port;
  return {
    dir: globalOpts.dir,
    port: localPort !== undefined ? parsePort(localPort) : globalOpts.port,
  };
}

function parsePort(value: string): number {
  return Number.parseInt(value, 10);
}

/** Start the web server, exiting with a helpful message on failure. */
export async function runServe(options: ServeOptions): Promise<void> {
  const { dir, port } = options;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Error: Invalid port "${port}".`);
    process.exit(1);
  }
  try {
    const config = await readConfig(dir);
    await startServer({ dir, port, config });
  } catch {
    console.error('Error: Could not start server. Is this a gitrac project?');
    console.error('Run "gitrac init" to initialize the .issues directory.');
    process.exit(1);
  }
}

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the web UI (default when no command is given)')
    .option('-p, --port <port>', 'Port for the web server (default: 3000)')
    .action(async (_options: unknown, cmd: Command) => {
      await runServe(resolveServeOptions(program, cmd));
    });
}
