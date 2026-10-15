import type { Command } from 'commander';
import { issueNotFound, parseIssueIdArg } from '../../core/errors.ts';
import { parseIssue } from '../../core/issue.ts';
import { assertCanReopen, reopenStatus } from '../../core/lifecycle.ts';
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

export function registerReopenCommand(program: Command): void {
  program
    .command('reopen <id>')
    .description('Reopen a closed issue')
    .option(
      '-s, --status <status>',
      'Status to reopen with (default: config defaultStatus)',
    )
    .option('-c, --comment <text>', 'Add a comment when reopening')
    .action(
      async (idStr: string, options: { status?: string; comment?: string }) => {
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
          // Validate the requested status before touching anything
          const status = reopenStatus(config, options.status);

          const raw = await readIssueContent(dir, id);
          if (!raw) throw issueNotFound(id);
          const issue = parseIssue(raw.content);

          // Reopening an open issue is an error (exit 3), not a rewrite.
          assertCanReopen(issue, raw.closed);

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

          // Write into .issues/ and remove the closed copy
          const paths = await relocateIssue(dir, issue, raw, {
            closed: false,
          });

          const format = globalOpts.output;
          console.log(formatIssueDetail(issue, format));

          await commitAndMaybePush(
            globalOpts,
            config,
            paths,
            `${config.git.commitPrefix} reopen #${id} ${issue.title}`,
          );
        });
      },
    );
}
