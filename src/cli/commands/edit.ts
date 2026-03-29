import { join } from 'node:path';
import type { Command } from 'commander';
import type { OutputFormat, Priority, Status } from '../../core/types.ts';
import { isClosedStatus } from '../../core/types.ts';
import {
  deleteIssueFile,
  findIssueFile,
  readConfig,
  readIssue,
  writeIssue,
} from '../../fs/issue-store.ts';
import { commitIssueChange, pushIfConfigured } from '../../git/operations.ts';
import { getGitRoot } from '../../git/status.ts';
import { formatIssueDetail } from '../output.ts';

export function registerEditCommand(program: Command): void {
  program
    .command('edit <id>')
    .description('Edit an issue')
    .option('-t, --title <title>', 'New title')
    .option('-s, --status <status>', 'New status')
    .option('-p, --priority <priority>', 'New priority')
    .option('-a, --assignee <assignee>', 'New assignee')
    .option('-l, --labels <labels>', 'New labels (comma-separated)')
    .action(
      async (
        idStr: string,
        options: {
          title?: string;
          status?: string;
          priority?: string;
          assignee?: string;
          labels?: string;
        },
      ) => {
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

        const found = await findIssueFile(dir, id);
        if (!found) {
          console.error(`Error: Issue #${id} not found.`);
          process.exit(1);
        }

        const wasClosed = found.closed;
        const oldFilename = found.filename;

        const issue = await readIssue(dir, id);

        // Apply changes
        if (options.title !== undefined) issue.title = options.title;
        if (options.status !== undefined)
          issue.status = options.status as Status;
        if (options.priority !== undefined)
          issue.priority = options.priority as Priority;
        if (options.assignee !== undefined) issue.assignee = options.assignee;
        if (options.labels !== undefined) {
          issue.labels = options.labels.split(',').map((l) => l.trim());
        }

        issue.updated = new Date().toISOString();

        const nowClosed = isClosedStatus(issue.status);
        const newFilename = await writeIssue(dir, issue, {
          closed: nowClosed,
        });

        // Clean up old file if filename changed or issue moved directories
        const filenameChanged = newFilename !== oldFilename;
        const directoryChanged = wasClosed !== nowClosed;
        if (filenameChanged || directoryChanged) {
          await deleteIssueFile(dir, oldFilename, wasClosed);
        }

        const newDir = nowClosed ? join('.issues', 'closed') : '.issues';
        const filesToCommit = [
          join(newDir, newFilename),
          '.issues/config.yaml',
        ];

        // Include old file path for git tracking
        if (filenameChanged || directoryChanged) {
          const oldDir = wasClosed ? join('.issues', 'closed') : '.issues';
          filesToCommit.push(join(oldDir, oldFilename));
        }

        const format = (globalOpts.output || 'human') as OutputFormat;
        console.log(formatIssueDetail(issue, format));

        if (!globalOpts.noCommit && config.git.autoCommit) {
          await commitIssueChange(
            dir,
            filesToCommit,
            `${config.git.commitPrefix} edit #${id} ${issue.title}`,
          );
          await pushIfConfigured(dir, config, {
            push: globalOpts.push,
            noPush: globalOpts.noPush,
          });
        }
      },
    );
}
