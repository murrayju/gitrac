import { Command, Option } from 'commander';
import { registerClaimCommand } from './commands/claim.ts';
import { registerCloseCommand } from './commands/close.ts';
import { registerCommentCommand } from './commands/comment.ts';
import { registerCreateCommand } from './commands/create.ts';
import { registerDeleteCommand } from './commands/delete.ts';
import { registerEditCommand } from './commands/edit.ts';
import { registerInitCommand } from './commands/init.ts';
import { registerListCommand } from './commands/list.ts';
import { registerReopenCommand } from './commands/reopen.ts';
import {
  registerServeCommand,
  resolveServeOptions,
  runServe,
} from './commands/serve.ts';
import { registerShowCommand } from './commands/show.ts';
import { registerUnclaimCommand } from './commands/unclaim.ts';
import { reportError, scanErrorOptions } from './errors.ts';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('gitrac')
    .description('Manage project issues as markdown files in git')
    .version('0.1.0')
    // Errors (including usage errors) are thrown instead of exiting, and
    // printed by the top-level handler in runCli. Subcommands inherit both
    // settings, so these must come before the commands are registered.
    .exitOverride()
    .configureOutput({ outputError: () => {} })
    .addOption(
      new Option('-o, --output <format>', 'Output format (human, json, yaml)')
        .choices(['human', 'json', 'yaml'])
        .default('human'),
    )
    .option('--debug', 'Print stack traces on errors')
    .option('--push', 'Push after commit')
    .option('--no-push', 'Do not push after commit')
    .option('--no-commit', 'Do not auto-commit changes')
    .option('--author <name>', 'Author name for comments')
    .option('--dir <path>', 'Path inside the project repo (default: cwd)')
    // Long-only on purpose: subcommands own short flags like `-p` (e.g.
    // `create -p high`). Program-level options are matched anywhere in argv,
    // so a global `-p` would swallow them. `serve` accepts `-p, --port`.
    .option('--port <port>', 'Port for the web server (default: 3000)')
    .option(
      '--host <host>',
      'Interface for the web server (default: 127.0.0.1)',
    )
    .action(async () => {
      // Bare `gitrac` is an alias for `gitrac serve`.
      await runServe(resolveServeOptions(program));
    });

  registerServeCommand(program);
  registerInitCommand(program);
  registerCreateCommand(program);
  registerListCommand(program);
  registerShowCommand(program);
  registerEditCommand(program);
  registerCommentCommand(program);
  registerCloseCommand(program);
  registerReopenCommand(program);
  registerClaimCommand(program);
  registerUnclaimCommand(program);
  registerDeleteCommand(program);

  return program;
}

/**
 * Run the CLI with the single top-level error handler: any error thrown by a
 * command (or by Commander's argument parsing) is printed to stderr as
 * `Error: <message>` (human) or `{"error":{"code","message"}}` (json/yaml)
 * and the process exits with the error's exit code (see `src/core/errors.ts`).
 * Stack traces are only shown with `--debug`.
 */
export async function runCli(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    process.exit(reportError(err, scanErrorOptions(argv.slice(2))));
  }
}
