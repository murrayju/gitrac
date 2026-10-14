import type { Command } from 'commander';
import { issueFilename } from '../../core/slug.ts';
import {
  moveToClose,
  readConfig,
  readIssue,
  writeIssue,
} from '../../fs/issue-store.ts';
import { getGitRoot } from '../../git/status.ts';
import { commitAndMaybePush, getGlobalOptions } from '../global-options.ts';
import { formatIssueDetail } from '../output.ts';

export function registerCloseCommand(program: Command): void {
  program
    .command('close <id>')
    .description('Close an issue')
    .option('--cancelled', 'Set status to cancelled instead of done')
    .option('-c, --comment <text>', 'Add a comment when closing')
    .action(
      async (
        idStr: string,
        options: { cancelled?: boolean; comment?: string },
      ) => {
        const globalOpts = getGlobalOptions(program);
        const { dir } = globalOpts;

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

        // Resolve author for comments
        let author = globalOpts.author;
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
          const status = options.cancelled ? 'cancelled' : 'done';
          issue.status = status;
          const now = new Date().toISOString();
          issue.updated = now;

          if (options.comment) {
            issue.comments.push({
              author,
              timestamp: now,
              body: options.comment,
            });
          }

          // Write the updated issue (still in open dir)
          await writeIssue(dir, issue);

          // Move to closed directory
          await moveToClose(dir, id);

          const format = globalOpts.output;
          console.log(formatIssueDetail(issue, format));

          const filename = issueFilename(issue.id, issue.title);
          await commitAndMaybePush(
            globalOpts,
            config,
            [`.issues/${filename}`, `.issues/closed/${filename}`],
            `${config.git.commitPrefix} close #${id} ${issue.title}`,
          );
        } catch (err) {
          console.error(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }
      },
    );
}
