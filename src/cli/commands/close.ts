import type { Command } from 'commander';
import { EXIT_ALREADY_CLAIMED } from '../../core/claim.ts';
import { parseIssueIdArg } from '../../core/errors.ts';
import { closeIssue } from '../../service/issues.ts';
import { withHint } from '../errors.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { cliServiceContext, printWrittenIssue } from '../service-context.ts';

export function registerCloseCommand(program: Command): void {
  program
    .command('close <id>')
    .description(
      'Close an issue. ' +
        `Closing an issue someone else has claimed (here, in another worktree or on another branch) exits ${EXIT_ALREADY_CLAIMED} (override with --force).`,
    )
    .option(
      '--cancelled',
      'Close with the configured cancel status (default: cancelled)',
    )
    .option(
      '-s, --status <status>',
      'Closed status to set (default: config closeStatus, i.e. done)',
    )
    .option('-c, --comment <text>', 'Add a comment when closing')
    .option('-f, --force', 'Close even if someone else has claimed the issue')
    .action(
      async (
        idStr: string,
        options: {
          cancelled?: boolean;
          status?: string;
          comment?: string;
          force?: boolean;
        },
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
            force: options.force,
          },
        ).catch((err: unknown) => {
          throw withHint(err, {
            already_claimed: 'Use --force to close it anyway.',
          });
        });
      },
    );
}
