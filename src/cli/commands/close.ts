import type { Command } from 'commander';
import { parseIssueIdArg } from '../../core/errors.ts';
import { issueFilename } from '../../core/slug.ts';
import {
  moveToClose,
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
        const globalOpts = await resolveProjectOptions(program);
        const { dir } = globalOpts;

        const id = parseIssueIdArg(idStr);

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
        });
      },
    );
}
