import { Command } from 'commander';
import { registerClaimCommand } from './commands/claim.ts';
import { registerCloseCommand } from './commands/close.ts';
import { registerCommentCommand } from './commands/comment.ts';
import { registerCreateCommand } from './commands/create.ts';
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

export function createProgram(): Command {
  const program = new Command();

  program
    .name('gitrac')
    .description('Manage project issues as markdown files in git')
    .version('0.1.0')
    .option(
      '-o, --output <format>',
      'Output format (human, json, yaml)',
      'human',
    )
    .option('--push', 'Push after commit')
    .option('--no-push', 'Do not push after commit')
    .option('--no-commit', 'Do not auto-commit changes')
    .option('--author <name>', 'Author name for comments')
    .option('--dir <path>', 'Path inside the project repo (default: cwd)')
    // Long-only on purpose: subcommands own short flags like `-p` (e.g.
    // `create -p high`). Program-level options are matched anywhere in argv,
    // so a global `-p` would swallow them. `serve` accepts `-p, --port`.
    .option('--port <port>', 'Port for the web server (default: 3000)')
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

  return program;
}
