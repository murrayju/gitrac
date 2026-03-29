import { join } from 'node:path';
import type { Command } from 'commander';
import type { OutputFormat } from '../../core/types.ts';
import {
  findIssueFile,
  readConfig,
  readIssue,
  writeIssue,
} from '../../fs/issue-store.ts';
import { commitIssueChange, pushIfConfigured } from '../../git/operations.ts';
import { getGitRoot } from '../../git/status.ts';
import { formatIssueDetail } from '../output.ts';

export function registerCommentCommand(program: Command): void {
  program
    .command('comment <id> [body]')
    .alias('c')
    .description('Add a comment to an issue')
    .action(async (idStr: string, body?: string) => {
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

      const format = (globalOpts.output || 'human') as OutputFormat;
      console.log(formatIssueDetail(issue, format));

      if (!globalOpts.noCommit && config.git.autoCommit) {
        const relDir = isClosed ? join('.issues', 'closed') : '.issues';
        await commitIssueChange(
          dir,
          [join(relDir, filename)],
          `${config.git.commitPrefix} comment on #${id}`,
        );
        await pushIfConfigured(dir, config, {
          push: globalOpts.push,
          noPush: globalOpts.noPush,
        });
      }
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
