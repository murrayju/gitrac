import type { Command } from 'commander';
import { issueFilename } from '../../core/slug.ts';
import {
  moveToReopen,
  readConfig,
  readIssue,
  writeIssue,
} from '../../fs/issue-store.ts';
import {
  commitAndMaybePush,
  resolveProjectOptions,
  withMutationLock,
} from '../global-options.ts';
import { formatIssueDetail } from '../output.ts';

export function registerReopenCommand(program: Command): void {
  program
    .command('reopen <id>')
    .description('Reopen a closed issue')
    .option('-c, --comment <text>', 'Add a comment when reopening')
    .action(async (idStr: string, options: { comment?: string }) => {
      const globalOpts = await resolveProjectOptions(program);
      const { dir } = globalOpts;

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

      await withMutationLock(globalOpts, async () => {
        const config = await readConfig(dir);
        try {
          // Move from closed to open first
          await moveToReopen(dir, id);

          // Read, update status, write
          const issue = await readIssue(dir, id);
          issue.status = 'backlog';
          const now = new Date().toISOString();
          issue.updated = now;

          if (options.comment) {
            issue.comments.push({
              author,
              timestamp: now,
              body: options.comment,
            });
          }

          await writeIssue(dir, issue);

          const format = globalOpts.output;
          console.log(formatIssueDetail(issue, format));

          const filename = issueFilename(issue.id, issue.title);
          await commitAndMaybePush(
            globalOpts,
            config,
            [`.issues/${filename}`, `.issues/closed/${filename}`],
            `${config.git.commitPrefix} reopen #${id} ${issue.title}`,
          );
        } catch (err) {
          console.error(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }
      });
    });
}
