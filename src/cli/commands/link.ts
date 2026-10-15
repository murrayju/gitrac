import type { Command } from 'commander';
import { invalidInput, parseIssueIdArg } from '../../core/errors.ts';
import { splitValues } from '../../core/query.ts';
import { linkIssue, unlinkIssue } from '../../service/links.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { formatIssueDetail } from '../output.ts';
import { cliServiceContext, printWrittenIssue } from '../service-context.ts';

/** Collect a repeatable option's values (`-b 3 -b 4`). */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** Parse `--blocked-by` values (comma-separated and/or repeated IDs). */
function parseIdList(values: string[] | undefined): number[] | undefined {
  if (values === undefined) return undefined;
  const ids = splitValues(values).map(parseIssueIdArg);
  if (ids.length === 0) throw invalidInput('--blocked-by needs an issue ID');
  return ids;
}

export function registerLinkCommands(program: Command): void {
  program
    .command('link <id>')
    .description(
      'Link an issue: mark it blocked by other issues and/or set its parent. ' +
        'Exits 2 (nothing written) if a target is missing, the issue itself, or the link would create a cycle.',
    )
    .option(
      '-b, --blocked-by <ids>',
      'Issue(s) this one is blocked by, comma-separated (repeatable)',
      collect,
    )
    .option('--parent <id>', 'Make it a sub-issue of <id>')
    .action(
      async (
        idStr: string,
        options: { blockedBy?: string[]; parent?: string },
      ) => {
        const globalOpts = await resolveProjectOptions(program);
        const id = parseIssueIdArg(idStr);
        const blockedBy = parseIdList(options.blockedBy);
        const parent =
          options.parent === undefined
            ? undefined
            : parseIssueIdArg(options.parent);
        if (blockedBy === undefined && parent === undefined) {
          throw invalidInput(
            'Nothing to link: give --blocked-by and/or --parent',
          );
        }

        const result = await linkIssue(
          cliServiceContext(globalOpts, printWrittenIssue(globalOpts)),
          id,
          { blockedBy, parent },
        );
        if (!result.changed) {
          console.error(`Issue #${id} is already linked; nothing changed.`);
          console.log(formatIssueDetail(result.issue, globalOpts.output));
        }
      },
    );

  program
    .command('unlink <id>')
    .description(
      'Remove links from an issue: blockers (--blocked-by) and/or its parent (--parent)',
    )
    .option(
      '-b, --blocked-by <ids>',
      'Blocker(s) to remove, comma-separated (repeatable)',
      collect,
    )
    .option('--parent', 'Clear the parent')
    .action(
      async (
        idStr: string,
        options: { blockedBy?: string[]; parent?: boolean },
      ) => {
        const globalOpts = await resolveProjectOptions(program);
        const id = parseIssueIdArg(idStr);
        const blockedBy = parseIdList(options.blockedBy);
        if (blockedBy === undefined && !options.parent) {
          throw invalidInput(
            'Nothing to unlink: give --blocked-by and/or --parent',
          );
        }

        const result = await unlinkIssue(
          cliServiceContext(globalOpts, printWrittenIssue(globalOpts)),
          id,
          { blockedBy, parent: options.parent || undefined },
        );
        if (!result.changed) {
          console.error(`Issue #${id} has no such links; nothing changed.`);
          console.log(formatIssueDetail(result.issue, globalOpts.output));
        }
      },
    );
}
