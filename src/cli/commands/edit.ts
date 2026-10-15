import { join } from 'node:path';
import type { Command } from 'commander';
import { issueNotFound, parseIssueIdArg } from '../../core/errors.ts';
import { isClosedStatus } from '../../core/types.ts';
import { parseLabelList, validateIssueFields } from '../../core/validate.ts';
import {
  deleteIssueFile,
  findIssueFile,
  readConfig,
  readIssue,
  registerLabels,
  writeIssue,
} from '../../fs/issue-store.ts';
import {
  commitAndMaybePush,
  resolveProjectOptions,
  withMutationLock,
} from '../global-options.ts';
import { formatIssueDetail } from '../output.ts';
import { resolveTextOption } from '../text-input.ts';
import { throwValidationErrors } from '../validation.ts';

export function registerEditCommand(program: Command): void {
  program
    .command('edit <id>')
    .description('Edit an issue')
    .option('-t, --title <title>', 'New title')
    .option('-s, --status <status>', 'New status')
    .option('-p, --priority <priority>', 'New priority')
    .option('-a, --assignee <assignee>', 'New assignee')
    .option('-l, --labels <labels>', 'New labels (comma-separated)')
    .option('-d, --description <text>', 'New description (markdown)')
    .option(
      '--description-file <path>',
      'Read the new description from a file (`-` for stdin)',
    )
    .option('-c, --comment <text>', 'Add a comment with this edit')
    .action(
      async (
        idStr: string,
        options: {
          title?: string;
          status?: string;
          priority?: string;
          assignee?: string;
          labels?: string;
          comment?: string;
          description?: string;
          descriptionFile?: string;
        },
      ) => {
        const globalOpts = await resolveProjectOptions(program);
        const { dir } = globalOpts;

        const id = parseIssueIdArg(idStr);

        // Read the description (possibly from stdin) before taking the lock.
        const newDescription = await resolveTextOption({
          inline: options.description,
          file: options.descriptionFile,
          inlineFlag: '--description',
          fileFlag: '--description-file',
        });

        await withMutationLock(globalOpts, async () => {
          const config = await readConfig(dir);
          const found = await findIssueFile(dir, id);
          if (!found) throw issueNotFound(id);

          const wasClosed = found.closed;
          const oldFilename = found.filename;

          const issue = await readIssue(dir, id);

          // Validate all changes before writing anything
          const fields = validateIssueFields(
            {
              title: options.title,
              status: options.status,
              priority: options.priority,
              assignee: options.assignee,
              description: newDescription,
              labels:
                options.labels !== undefined
                  ? parseLabelList(options.labels)
                  : undefined,
            },
            config,
          );
          if (!fields.valid) throwValidationErrors(fields.errors);
          const { title, status, priority, assignee, labels, description } =
            fields.values;

          // Apply changes
          if (title !== undefined) issue.title = title;
          if (status !== undefined) issue.status = status;
          if (priority !== undefined) issue.priority = priority;
          if (assignee !== undefined) issue.assignee = assignee;
          if (labels !== undefined) issue.labels = labels;
          if (description !== undefined) issue.description = description;

          const now = new Date().toISOString();
          issue.updated = now;

          if (options.comment) {
            // Resolve author for comment
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
            issue.comments.push({
              author,
              timestamp: now,
              body: options.comment,
            });
          }

          const nowClosed = isClosedStatus(issue.status);
          const newFilename = await writeIssue(dir, issue, {
            closed: nowClosed,
          });
          // Unknown labels are registered in config.yaml with a color, the
          // same as the web UI does.
          await registerLabels(dir, issue.labels);

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

          const format = globalOpts.output;
          console.log(formatIssueDetail(issue, format));

          await commitAndMaybePush(
            globalOpts,
            config,
            filesToCommit,
            `${config.git.commitPrefix} edit #${id} ${issue.title}`,
          );
        });
      },
    );
}
