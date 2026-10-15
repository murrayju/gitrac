import type { Command } from 'commander';
import { parseIssueIdArg } from '../../core/errors.ts';
import { closeIssue } from '../../service/issues.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { cliServiceContext, printWrittenIssue } from '../service-context.ts';

export function registerCloseCommand(program: Command): void {
  program
    .command('close <id>')
    .description('Close an issue')
    .option(
      '--cancelled',
      'Close with the configured cancel status (default: cancelled)',
    )
    .option(
      '-s, --status <status>',
      'Closed status to set (default: config closeStatus, i.e. done)',
    )
    .option('-c, --comment <text>', 'Add a comment when closing')
    .action(
      async (
        idStr: string,
        options: { cancelled?: boolean; status?: string; comment?: string },
      ) => {
        const globalOpts = await resolveProjectOptions(program);

        const id = parseIssueIdArg(idStr);

        // Closing a closed issue is an error (exit 3), not a rewrite.
        await closeIssue(
          cliServiceContext(globalOpts, printWrittenIssue(globalOpts)),
          id,
          {
            cancelled: options.cancelled,
            status: options.status,
            comment: options.comment,
          },
        );
      },
    );
}
