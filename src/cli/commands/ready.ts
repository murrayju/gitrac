import type { Command } from 'commander';
import { invalidInput } from '../../core/errors.ts';
import { parseIssueQuery, SORT_FIELDS } from '../../core/query.ts';
import { readConfig } from '../../fs/issue-store.ts';
import { getBranchWarning } from '../../git/status.ts';
import {
  claimNextIssue,
  findNextIssue,
  listReadyIssues,
} from '../../service/ready.ts';
import {
  type GlobalOptions,
  resolveProjectOptions,
} from '../global-options.ts';
import { formatIssueDetail, formatIssueList } from '../output.ts';
import {
  cliServiceContext,
  printWrittenIssue,
  resolveClaimUser,
} from '../service-context.ts';

/** Collect a repeatable option's values (`--label a --label b`). */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

interface ReadyFilterOptions {
  status?: string[];
  mine?: boolean;
  label?: string[];
  priority?: string[];
  search?: string;
  sort?: string;
}

/** The `ls` filters that make sense for ready work (no `--assignee`). */
function addFilterOptions(command: Command): Command {
  return command
    .option(
      '--status <status>',
      'Only these open statuses, comma-separated (default: every open status)',
      collect,
    )
    .option('--mine', 'Only issues already assigned to you')
    .option('--label <label>', 'Filter by label, comma-separated', collect)
    .option(
      '--priority <priority>',
      'Filter by priority, comma-separated',
      collect,
    )
    .option(
      '--search <text>',
      'Only issues whose title or description contains every word of <text>',
    )
    .option(
      '--sort <field>',
      `Sort by field (${SORT_FIELDS.join(', ')}); ties by ID`,
      'priority',
    );
}

function warnUnreadable(unreadable: string[]): void {
  for (const path of unreadable) {
    console.warn(`Warning: skipping unreadable issue file ${path}`);
  }
}

/** Resolve the project, config, user and query shared by `ready` / `next`. */
async function prepare(program: Command, options: ReadyFilterOptions) {
  const globalOpts: GlobalOptions = await resolveProjectOptions(program);
  const { dir } = globalOpts;
  const config = await readConfig(dir);
  const user = await resolveClaimUser(globalOpts);
  const query = parseIssueQuery(options, config, {
    mine: options.mine ? user : undefined,
  });
  const warning = await getBranchWarning(dir, config);
  if (warning) console.warn(`Warning: ${warning}`);
  return { globalOpts, dir, config, user, query };
}

export function registerReadyCommands(program: Command): void {
  addFilterOptions(
    program
      .command('ready')
      .description(
        'List issues ready to work on: open, unassigned or yours, and not blocked by an open issue. ' +
          'Sorted by priority, then ID.',
      ),
  ).action(async (options: ReadyFilterOptions) => {
    const { globalOpts, dir, config, user, query } = await prepare(
      program,
      options,
    );
    const { issues, unreadable } = await listReadyIssues(
      dir,
      user,
      query,
      config,
    );
    warnUnreadable(unreadable);
    console.log(formatIssueList(issues, globalOpts.output));
  });

  addFilterOptions(
    program
      .command('next')
      .description(
        'Show the top ready issue that is not already in progress; with --claim, claim it ' +
          '(atomically, under the repo lock). Exits 5 if no issue is ready.',
      )
      .option('--claim', 'Claim it (assign to yourself and set in_progress)')
      .option('-c, --comment <text>', 'Add a comment when claiming'),
  ).action(
    async (
      options: ReadyFilterOptions & { claim?: boolean; comment?: string },
    ) => {
      if (options.comment !== undefined && !options.claim) {
        throw invalidInput('--comment needs --claim');
      }
      const { globalOpts, dir, config, user, query } = await prepare(
        program,
        options,
      );
      if (!options.claim) {
        const { issue, unreadable } = await findNextIssue(
          dir,
          user,
          query,
          config,
        );
        warnUnreadable(unreadable);
        console.log(formatIssueDetail(issue, globalOpts.output));
        return;
      }
      const result = await claimNextIssue(
        cliServiceContext(globalOpts, printWrittenIssue(globalOpts)),
        query,
        { comment: options.comment },
      );
      warnUnreadable(result.unreadable);
      // `next` never picks an issue that is already in progress, so a claim
      // always changes it; the no-op branch is just for completeness.
      if (!result.changed) {
        console.log(formatIssueDetail(result.issue, globalOpts.output));
      }
    },
  );
}
