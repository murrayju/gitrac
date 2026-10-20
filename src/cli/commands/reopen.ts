import type { Command } from 'commander';
import { EXIT_ALREADY_CLAIMED } from '../../core/claim.ts';
import { parseIssueIdArg } from '../../core/errors.ts';
import { reopenIssue } from '../../service/issues.ts';
import { withHint } from '../errors.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { cliServiceContext, printWrittenIssue } from '../service-context.ts';

export function registerReopenCommand(program: Command): void {
  program
    .command('reopen <id>')
    .description(
      'Reopen a closed issue. ' +
        `Reopening an issue someone else has claimed in a newer version (in another worktree or on another branch) exits ${EXIT_ALREADY_CLAIMED} (override with --force).`,
    )
    .option(
      '-s, --status <status>',
      'Status to reopen with (default: config defaultStatus)',
    )
    .option('-c, --comment <text>', 'Add a comment when reopening')
    .option('-f, --force', 'Reopen even if someone else has claimed the issue')
    .action(
      async (
        idStr: string,
        options: { status?: string; comment?: string; force?: boolean },
      ) => {
        const globalOpts = await resolveProjectOptions(program);

        const id = parseIssueIdArg(idStr);

        // Reopening an open issue is an error (exit 3), not a rewrite.
        await reopenIssue(
          cliServiceContext(globalOpts, printWrittenIssue(globalOpts)),
          id,
          {
            status: options.status,
            comment: options.comment,
            force: options.force,
          },
        ).catch((err: unknown) => {
          throw withHint(err, {
            already_claimed: 'Use --force to reopen it anyway.',
          });
        });
      },
    );
}
