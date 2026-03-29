import type { Command } from 'commander';
import type { OutputFormat } from '../../core/types.ts';
import { readConfig, readIssue, writeIssue } from '../../fs/issue-store.ts';
import { commitIssueChange, pushIfConfigured } from '../../git/operations.ts';
import { getGitRoot } from '../../git/status.ts';
import { formatIssueDetail } from '../output.ts';

export function registerClaimCommand(program: Command): void {
  program
    .command('claim <id>')
    .description('Claim an issue (assign to yourself and set in_progress)')
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
      const id = Number.parseInt(idStr, 10);
      if (Number.isNaN(id)) {
        console.error('Error: Invalid issue ID.');
        process.exit(1);
      }

      // Get current user
      let author = globalOpts.author || '';
      if (!author) {
        try {
          const { default: simpleGit } = await import('simple-git');
          const git = simpleGit(dir);
          author = (await git.getConfig('user.name')).value || 'unknown';
        } catch {
          author = 'unknown';
        }
      }

      try {
        const issue = await readIssue(dir, id);
        issue.assignee = author;
        issue.status = 'in_progress';
        issue.updated = new Date().toISOString();

        const filename = await writeIssue(dir, issue);

        const format = (globalOpts.output || 'human') as OutputFormat;
        console.log(formatIssueDetail(issue, format));

        if (!globalOpts.noCommit && config.git.autoCommit) {
          await commitIssueChange(
            dir,
            [`.issues/${filename}`],
            `${config.git.commitPrefix} claim #${id} ${issue.title}`,
          );
          await pushIfConfigured(dir, config, {
            push: globalOpts.push,
            noPush: globalOpts.noPush,
          });
        }
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });
}
