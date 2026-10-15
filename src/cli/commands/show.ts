import type { Command } from 'commander';
import { parseIssueIdArg } from '../../core/errors.ts';
import { readConfig, readIssue } from '../../fs/issue-store.ts';
import { getBranchWarning } from '../../git/status.ts';
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
      console.log(formatIssueDetail(issue, globalOpts.output));
    });
}
