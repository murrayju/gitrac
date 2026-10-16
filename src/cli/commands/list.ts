import type { Command } from 'commander';
import type { ElsewhereMarks } from '../../core/elsewhere.ts';
import { parseIssueQuery, SORT_FIELDS } from '../../core/query.ts';
import { readConfig } from '../../fs/issue-store.ts';
import { getBranchWarning } from '../../git/status.ts';
import {
  findMarksElsewhere,
  listIssues,
  marksFromStates,
  scanElsewhere,
} from '../../service/list.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { formatIssueList } from '../output.ts';
import { resolveClaimUser } from '../service-context.ts';

/** Collect a repeatable option's values (`--label a --label b`). */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('List issues')
    .option(
      '--status <status>',
      'Filter by status, comma-separated (or "all"; default: open issues)',
      collect,
    )
    .option(
      '--assignee <assignee>',
      'Filter by assignee name or email (case-insensitive), comma-separated',
      collect,
    )
    .option('--mine', 'Only issues assigned to you (git identity / --author)')
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
    .option('--sort <field>', `Sort by field (${SORT_FIELDS.join(', ')})`, 'id')
    .option(
      '--elsewhere',
      'Also list issues that exist only in another worktree or on another branch',
    )
    .action(
      async (options: {
        status?: string[];
        assignee?: string[];
        mine?: boolean;
        label?: string[];
        priority?: string[];
        search?: string;
        sort?: string;
        elsewhere?: boolean;
      }) => {
        const globalOpts = await resolveProjectOptions(program);
        const { dir } = globalOpts;

        const config = await readConfig(dir);
        const query = parseIssueQuery(options, config, {
          mine: options.mine ? await resolveClaimUser(globalOpts) : undefined,
        });

        // Print branch warning
        const warning = await getBranchWarning(dir, config);
        if (warning) {
          console.warn(`Warning: ${warning}`);
        }

        // `--elsewhere`: one scan of every issue (with the parsed issues)
        // gives both the issues only elsewhere and the marks.
        const states = options.elsewhere ? scanElsewhere(dir) : undefined;
        const { issues, unreadable, misplaced, elsewhere } = await listIssues(
          dir,
          query,
          config,
          { elsewhere: states },
        );
        for (const path of unreadable) {
          console.warn(`Warning: skipping unreadable issue file ${path}`);
        }
        for (const path of misplaced) {
          console.warn(
            `Warning: issue file ${path} is in the wrong directory for its status; the next change to the issue moves it`,
          );
        }

        const marks: Map<number, ElsewhereMarks> = states
          ? marksFromStates(issues, config, await states)
          : await findMarksElsewhere(dir, issues, config);
        for (const { issue, foundElsewhere } of elsewhere) {
          marks.set(issue.id, { foundElsewhere });
        }
        console.log(
          formatIssueList(
            [...issues, ...elsewhere.map((e) => e.issue)],
            globalOpts.output,
            marks,
          ),
        );
      },
    );
}
