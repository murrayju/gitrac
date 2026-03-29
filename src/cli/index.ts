import { Command } from 'commander';
import { readConfig } from '../fs/issue-store.ts';
import { startServer } from '../web/server.ts';
import { registerClaimCommand } from './commands/claim.ts';
import { registerCloseCommand } from './commands/close.ts';
import { registerCommentCommand } from './commands/comment.ts';
import { registerCreateCommand } from './commands/create.ts';
import { registerEditCommand } from './commands/edit.ts';
import { registerInitCommand } from './commands/init.ts';
import { registerListCommand } from './commands/list.ts';
import { registerReopenCommand } from './commands/reopen.ts';
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
    .option('--dir <path>', 'Path to the project root (default: cwd)')
    .option('-p, --port <port>', 'Port for the web server', '3000')
    .action(async () => {
      const opts = program.opts();
      const dir = opts.dir || process.cwd();
      const port = Number.parseInt(opts.port, 10);

      try {
        const config = await readConfig(dir);
        await startServer({ dir, port, config });
      } catch {
        console.error(
          'Error: Could not start server. Is this a gitrac project?',
        );
        console.error('Run "gitrac init" to initialize the .issues directory.');
        process.exit(1);
      }
    });

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
