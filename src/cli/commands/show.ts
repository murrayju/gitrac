import type { Command } from 'commander';
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

      const config = await readConfig(dir);

      // Print branch warning
      const warning = await getBranchWarning(dir, config);
      if (warning) {
        console.warn(`Warning: ${warning}`);
      }

      const id = Number.parseInt(idStr, 10);
      if (Number.isNaN(id)) {
        console.error('Error: Invalid issue ID.');
        process.exit(1);
      }

      try {
        const issue = await readIssue(dir, id);
        const format = globalOpts.output;
        console.log(formatIssueDetail(issue, format));
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });
}
