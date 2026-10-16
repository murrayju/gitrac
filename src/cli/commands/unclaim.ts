import type { Command } from 'commander';
import { EXIT_ALREADY_CLAIMED, EXIT_ISSUE_CLOSED } from '../../core/claim.ts';
import { describeLocation } from '../../core/elsewhere.ts';
import { parseIssueIdArg } from '../../core/errors.ts';
import { unclaimIssue } from '../../service/claim.ts';
import { withHint } from '../errors.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { formatIssueDetail } from '../output.ts';
import { cliServiceContext, printWrittenIssue } from '../service-context.ts';

export function registerUnclaimCommand(program: Command): void {
  program
    .command('unclaim <id>')
    .alias('release')
    .description(
      'Give an issue back: clear the assignee and move the active status (in_progress) or review status back to the unclaim status (todo). ' +
        'Also releases a claim held in another worktree or on another branch. ' +
        `Exits ${EXIT_ALREADY_CLAIMED} if someone else has it (override with --force), ` +
        `${EXIT_ISSUE_CLOSED} if it is closed.`,
    )
    .option('-c, --comment <text>', 'Add a comment when releasing')
    .option('-f, --force', 'Release an issue claimed by someone else')
    .action(
      async (idStr: string, options: { comment?: string; force?: boolean }) => {
        const globalOpts = await resolveProjectOptions(program);
        const id = parseIssueIdArg(idStr);

        const result = await unclaimIssue(
          cliServiceContext(globalOpts, printWrittenIssue(globalOpts)),
          id,
          { comment: options.comment, force: options.force },
        ).catch((err: unknown) => {
          throw withHint(err, {
            already_claimed: 'Use --force to release it anyway.',
          });
        });
        if (result.changed && result.elsewhere) {
          console.error(
            `Released the claim by ${result.elsewhere.assignee} ${describeLocation(result.elsewhere)} (this newer version supersedes it).`,
          );
        }
        if (!result.changed) {
          console.error(
            options.comment
              ? `Issue #${id} is not claimed; nothing changed (comment not added; use "gitrac comment").`
              : `Issue #${id} is not claimed; nothing changed.`,
          );
          console.log(formatIssueDetail(result.issue, globalOpts.output));
        }
      },
    );
}
