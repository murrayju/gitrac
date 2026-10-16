import type { Command } from 'commander';
import { describeDependencies, indexIssues } from '../../core/dependencies.ts';
import { parseIssueIdArg } from '../../core/errors.ts';
import { readConfig, readIssue } from '../../fs/issue-store.ts';
import { getBranchWarning } from '../../git/status.ts';
import { findMarksElsewhere, loadAllIssues } from '../../service/list.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { formatIssueDetail } from '../output.ts';

export function registerShowCommand(program: Command): void {
  program
    .command('show <id>')
    .alias('view')
    .description('Show issue details')
    .action(async (idStr: string) => {
      const globalOpts = await resolveProjectOptions(program);
      const { dir } = globalOpts;

      const id = parseIssueIdArg(idStr);
      const config = await readConfig(dir);

      // Branch warning goes to stderr so it never corrupts -o json stdout.
      const warning = await getBranchWarning(dir, config);
      if (warning) {
        console.warn(`Warning: ${warning}`);
      }

      const issue = await readIssue(dir, id);
      // Resolve the linked issues (and the derived "blocks" / sub-issues)
      // against every issue. All output formats show them.
      const byId = indexIssues((await loadAllIssues(dir)).issues);
      byId.set(issue.id, issue);
      const deps = describeDependencies(issue, byId, config);
      const mark = (await findMarksElsewhere(dir, [issue], config)).get(
        issue.id,
      );
      console.log(formatIssueDetail(issue, globalOpts.output, deps, mark));
    });
}
