import { join } from 'node:path';
import type { Command } from 'commander';
import {
  invalidInput,
  issueNotFound,
  parseIssueIdArg,
} from '../../core/errors.ts';
import {
  findIssueFile,
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
import { readStdin, resolveTextOption } from '../text-input.ts';

interface Opts {
  bodyFile?: string;
}

export function registerCommentCommand(program: Command): void {
  program
    .command('comment <id> [body]')
    .alias('c')
    .description(
      'Add a comment to an issue (body from argument, --body-file, or piped stdin)',
    )
    .option(
      '-F, --body-file <path>',
      'Read the comment body from a file (`-` for stdin)',
    )
    .action(async (idStr: string, body: string | undefined, o: Opts) => {
      const globalOpts = await resolveProjectOptions(program);
      const { dir } = globalOpts;

      const id = parseIssueIdArg(idStr);

      let commentBody = await resolveTextOption({
        inline: body,
        file: o.bodyFile,
        inlineFlag: 'a body argument',
        fileFlag: '--body-file',
      });
      if (commentBody === undefined) {
        // Implicit stdin fallback when input is piped
        commentBody = (await readStdin({ onlyIfPiped: true })).trim();
      }
      if (!commentBody) {
        throw invalidInput('Comment body is required.');
      }

      // Get author name
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
        const found = await findIssueFile(dir, id);
        if (!found) throw issueNotFound(id);
        const isClosed = found.closed;

        const issue = await readIssue(dir, id);
        const now = new Date().toISOString();

        issue.comments.push({
          author,
          timestamp: now,
          body: commentBody,
        });
        issue.updated = now;

        const filename = await writeIssue(dir, issue, { closed: isClosed });

        const format = globalOpts.output;
        console.log(formatIssueDetail(issue, format));

        const relDir = isClosed ? join('.issues', 'closed') : '.issues';
        await commitAndMaybePush(
          globalOpts,
          config,
          [join(relDir, filename)],
          `${config.git.commitPrefix} comment on #${id}`,
        );
      });
    });
}
