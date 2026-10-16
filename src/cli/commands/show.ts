import type { Command } from 'commander';
import { describeDependencies, indexIssues } from '../../core/dependencies.ts';
import { describeLocation, type ElsewhereMarks } from '../../core/elsewhere.ts';
import { GitracError, parseIssueIdArg } from '../../core/errors.ts';
import type { Issue } from '../../core/types.ts';
import { readConfig, readIssue } from '../../fs/issue-store.ts';
import { getBranchWarning } from '../../git/status.ts';
import {
  findIssueElsewhere,
  findMarksElsewhere,
  loadAllIssues,
} from '../../service/list.ts';
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

      let issue: Issue;
      let mark: ElsewhereMarks | undefined;
      try {
        issue = await readIssue(dir, id);
      } catch (err) {
        // No local file: show the newest version in another worktree or on
        // another branch, if there is one (read-only).
        if (!(err instanceof GitracError && err.code === 'not_found')) {
          throw err;
        }
        const found = await findIssueElsewhere(dir, id);
        if (!found) throw err;
        issue = found.issue;
        mark = { foundElsewhere: found.foundElsewhere };
        console.warn(
          `Note: issue #${id} is not in this working tree; showing the version ${describeLocation(found.foundElsewhere)}.`,
        );
      }
      // Resolve the linked issues (and the derived "blocks" / sub-issues)
      // against every issue. All output formats show them.
      const byId = indexIssues((await loadAllIssues(dir)).issues);
      byId.set(issue.id, issue);
      const deps = describeDependencies(issue, byId, config);
      mark ??= (await findMarksElsewhere(dir, [issue], config)).get(issue.id);
      console.log(formatIssueDetail(issue, globalOpts.output, deps, mark));
    });
}
