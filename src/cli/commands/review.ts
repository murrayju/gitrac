import type { Command } from 'commander';
import { describeLocation } from '../../core/elsewhere.ts';
import {
  EXIT_CONFLICT,
  EXIT_INVALID_INPUT,
  EXIT_ISSUE_CLOSED,
  parseIssueIdArg,
} from '../../core/errors.ts';
import { submitForReview } from '../../service/claim.ts';
import { withHint } from '../errors.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { formatIssueDetail } from '../output.ts';
import { cliServiceContext, printWrittenIssue } from '../service-context.ts';

export function registerReviewCommand(program: Command): void {
  program
    .command('review <id>')
    .description(
      'Hand a claimed issue off for review: set the configured reviewStatus and keep the assignee, ' +
        'so the issue stays claimed (in every worktree and branch) until it is closed or unclaimed. ' +
        `Exits ${EXIT_INVALID_INPUT} if no reviewStatus is configured, ${EXIT_CONFLICT} if the issue is not claimed ` +
        `or someone else has it (override with --force), ${EXIT_ISSUE_CLOSED} if it is closed.`,
    )
    .option('-c, --comment <text>', 'Add a comment when handing off')
    .option('-f, --force', 'Hand off an issue claimed by someone else')
    .action(
      async (idStr: string, options: { comment?: string; force?: boolean }) => {
        const globalOpts = await resolveProjectOptions(program);
        const id = parseIssueIdArg(idStr);

        const result = await submitForReview(
          cliServiceContext(globalOpts, printWrittenIssue(globalOpts)),
          id,
          { comment: options.comment, force: options.force },
        ).catch((err: unknown) => {
          throw withHint(err, {
            already_claimed: 'Use --force to hand it off anyway.',
            invalid_state: `Use "gitrac claim ${id}" first.`,
          });
        });
        if (result.changed && result.elsewhere) {
          console.error(
            `Handed off the claim by ${result.elsewhere.assignee} ${describeLocation(result.elsewhere)} (this newer version supersedes it).`,
          );
        }
        if (!result.changed) {
          console.error(
            options.comment
              ? `Issue #${id} is already in review; nothing changed (comment not added; use "gitrac comment").`
              : `Issue #${id} is already in review; nothing changed.`,
          );
          console.log(formatIssueDetail(result.issue, globalOpts.output));
        }
      },
    );
}
