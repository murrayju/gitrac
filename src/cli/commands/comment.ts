import { join } from 'node:path';
import type { Command } from 'commander';
import {
  findIssueFile,
  readConfig,
  readIssue,
  writeIssue,
} from '../../fs/issue-store.ts';
import { getGitRoot } from '../../git/status.ts';
import {
  commitAndMaybePush,
  getGlobalOptions,
  withMutationLock,
} from '../global-options.ts';
import { formatIssueDetail } from '../output.ts';

export function registerCommentCommand(program: Command): void {
  program
    .command('comment <id> [body]')
    .alias('c')
    .description('Add a comment to an issue')
    .action(async (idStr: string, body?: string) => {
      const globalOpts = getGlobalOptions(program);
      const { dir } = globalOpts;

      try {
        await getGitRoot(dir);
      } catch {
        console.error('Error: Not inside a git repository.');
        process.exit(1);
      }

      const id = Number.parseInt(idStr, 10);
      if (Number.isNaN(id)) {
        console.error('Error: Invalid issue ID.');
        process.exit(1);
      }

      let commentBody = body;
      if (!commentBody) {
        // Read from stdin
        commentBody = await readStdin();
      }
      if (!commentBody) {
        console.error('Error: Comment body is required.');
        process.exit(1);
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
        if (!found) {
          console.error(`Error: Issue #${id} not found.`);
          process.exit(1);
        }
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

async function readStdin(): Promise<string> {
  // Check if stdin has data (not a TTY)
  if (process.stdin.isTTY) {
    return '';
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}
