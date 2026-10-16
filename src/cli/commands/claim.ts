import type { Command } from 'commander';
import { EXIT_ALREADY_CLAIMED, EXIT_ISSUE_CLOSED } from '../../core/claim.ts';
import { describeLocation } from '../../core/elsewhere.ts';
import { GitracError, parseIssueIdArg } from '../../core/errors.ts';
import { claimIssue } from '../../service/claim.ts';
import { withHint } from '../errors.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { formatIssueDetail } from '../output.ts';
import { cliServiceContext, printWrittenIssue } from '../service-context.ts';

export function registerClaimCommand(program: Command): void {
  program
    .command('claim <id>')
    .description(
      'Claim an issue (assign to yourself and set the active status, default in_progress). ' +
        `Exits ${EXIT_ALREADY_CLAIMED} if someone else has it, ` +
        `${EXIT_ISSUE_CLOSED} if it is closed (override with --force).`,
    )
    .option('-c, --comment <text>', 'Add a comment when claiming')
    .option(
      '-f, --force',
      'Take over an issue claimed by someone else, or reopen and claim a closed issue',
    )
    .option(
      '--renew',
      'If you already hold it, renew the claim (a heartbeat: newer updated, so it is not stale)',
    )
    .action(
      async (
        idStr: string,
        options: { comment?: string; force?: boolean; renew?: boolean },
      ) => {
        const globalOpts = await resolveProjectOptions(program);
        const id = parseIssueIdArg(idStr);

        const result = await claimIssue(
          cliServiceContext(globalOpts, printWrittenIssue(globalOpts)),
          id,
          {
            comment: options.comment,
            force: options.force,
            renew: options.renew,
          },
        ).catch((err: unknown) => {
          const closedThere =
            err instanceof GitracError &&
            err.details?.closedElsewhere !== undefined;
          throw withHint(err, {
            already_claimed: 'Use --force to take it over.',
            // Closed elsewhere: it is open here, so "reopen" can't help.
            issue_closed: closedThere
              ? 'Merge that branch to get the close here, or use --force to claim it anyway.'
              : `Use "gitrac reopen ${id}" first, or claim --force to reopen and claim it.`,
          });
        });
        if (result.changed && result.renewed) {
          console.error(`Renewed your claim on issue #${id}.`);
        }
        if (result.changed && result.elsewhere) {
          console.warn(
            `Warning: you already hold issue #${id} ${describeLocation(result.elsewhere)}; claimed it here too.`,
          );
        }
        if (!result.changed) {
          console.error(
            options.comment
              ? `Issue #${id} is already claimed by you; nothing changed (comment not added; use "gitrac comment").`
              : `Issue #${id} is already claimed by you; nothing changed.`,
          );
          console.log(formatIssueDetail(result.issue, globalOpts.output));
        }
      },
    );
}
