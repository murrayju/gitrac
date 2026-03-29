import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import { issueFilename } from '../../core/slug.ts';
import type { OutputFormat, Priority, Status } from '../../core/types.ts';
import {
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

        const issue = await readIssue(dir, id);
        const oldFilename = issueFilename(issue.id, issue.title);

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

        const newFilename = await writeIssue(dir, issue);
        const filesToCommit = [`.issues/${newFilename}`, '.issues/config.yaml'];

        // If title changed, remove old file
        if (newFilename !== oldFilename) {
          const base = found.closed
            ? join(dir, '.issues', 'closed')
            : join(dir, '.issues');
          try {
            await unlink(join(base, oldFilename));
          } catch {
            // old file may not exist if it's a different name pattern
          }
          filesToCommit.push(`.issues/${oldFilename}`);
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
