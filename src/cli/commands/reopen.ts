import type { Command } from 'commander';
import { parseIssueIdArg } from '../../core/errors.ts';
import { reopenIssue } from '../../service/issues.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { cliServiceContext, printWrittenIssue } from '../service-context.ts';

export function registerReopenCommand(program: Command): void {
  program
    .command('reopen <id>')
    .description('Reopen a closed issue')
    .option(
      '-s, --status <status>',
      'Status to reopen with (default: config defaultStatus)',
    )
    .option('-c, --comment <text>', 'Add a comment when reopening')
    .action(
      async (idStr: string, options: { status?: string; comment?: string }) => {
        const globalOpts = await resolveProjectOptions(program);

        const id = parseIssueIdArg(idStr);

        // Reopening an open issue is an error (exit 3), not a rewrite.
        await reopenIssue(
          cliServiceContext(globalOpts, printWrittenIssue(globalOpts)),
          id,
          { status: options.status, comment: options.comment },
        );
      },
    );
}
