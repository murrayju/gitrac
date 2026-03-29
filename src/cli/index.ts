import { Command } from 'commander';
import { registerCommentCommand } from './commands/comment.ts';
import { registerCreateCommand } from './commands/create.ts';
import { registerEditCommand } from './commands/edit.ts';
import { registerInitCommand } from './commands/init.ts';
import { registerListCommand } from './commands/list.ts';
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
    .action(() => {
      console.log('Web UI not yet implemented.');
    });

  registerInitCommand(program);
  registerCreateCommand(program);
  registerListCommand(program);
  registerShowCommand(program);
  registerEditCommand(program);
  registerCommentCommand(program);

  return program;
}
