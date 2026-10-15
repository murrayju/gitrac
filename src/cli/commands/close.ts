import type { Command } from 'commander';
import { issueNotFound, parseIssueIdArg } from '../../core/errors.ts';
import { parseIssue } from '../../core/issue.ts';
import { assertCanClose } from '../../core/lifecycle.ts';
import {
  readConfig,
  readIssueContent,
  relocateIssue,
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
          const raw = await readIssueContent(dir, id);
          if (!raw) throw issueNotFound(id);
          const issue = parseIssue(raw.content);

          // Closing a closed issue is an error (exit 3), not a rewrite.
          assertCanClose(issue, raw.closed);

          issue.status = options.cancelled ? 'cancelled' : 'done';
          const now = new Date().toISOString();
          issue.updated = now;

          if (options.comment) {
            issue.comments.push({
              author,
              timestamp: now,
              body: options.comment,
            });
          }

          // Write into .issues/closed/ and remove the open copy
          const paths = await relocateIssue(dir, issue, raw, { closed: true });

          const format = globalOpts.output;
          console.log(formatIssueDetail(issue, format));

          await commitAndMaybePush(
            globalOpts,
            config,
            paths,
            `${config.git.commitPrefix} close #${id} ${issue.title}`,
          );
        });
      },
    );
}
