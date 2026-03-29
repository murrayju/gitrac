import type { Command } from 'commander';
import type { OutputFormat } from '../../core/types.ts';
import { readConfig, readIssue } from '../../fs/issue-store.ts';
import { getBranchWarning, getGitRoot } from '../../git/status.ts';
import { formatIssueDetail } from '../output.ts';

export function registerShowCommand(program: Command): void {
  program
    .command('show <id>')
    .alias('view')
    .description('Show issue details')
    .action(async (idStr: string) => {
      const globalOpts = program.opts();
      const dir = globalOpts.dir || process.cwd();

      try {
        await getGitRoot(dir);
      } catch {
        console.error('Error: Not inside a git repository.');
        process.exit(1);
      }

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
        const format = (globalOpts.output || 'human') as OutputFormat;
        console.log(formatIssueDetail(issue, format));
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });
}
