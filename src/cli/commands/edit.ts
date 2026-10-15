import type { Command } from 'commander';
import { invalidInput, parseIssueIdArg } from '../../core/errors.ts';
import { parseLabelList } from '../../core/validate.ts';
import { updateIssue } from '../../service/issues.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { formatIssueDetail } from '../output.ts';
import { cliServiceContext, printWrittenIssue } from '../service-context.ts';
import { resolveTextOption } from '../text-input.ts';

export function registerEditCommand(program: Command): void {
  program
    .command('edit <id>')
    .description(
      'Edit an issue. Values equal to the current ones (a description differing only in surrounding whitespace) are a no-op: nothing is written or committed.',
    )
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

        const id = parseIssueIdArg(idStr);
        const given = [
          options.title,
          options.status,
          options.priority,
          options.assignee,
          options.labels,
          options.description,
          options.descriptionFile,
          options.comment,
        ];
        if (given.every((value) => value === undefined)) {
          throw invalidInput(
            'Nothing to edit: give at least one of --title, --status, --priority, --assignee, --labels, --description, --description-file, --comment',
          );
        }

        // Read the description (possibly from stdin) before taking the lock.
        const newDescription = await resolveTextOption({
          inline: options.description,
          file: options.descriptionFile,
          inlineFlag: '--description',
          fileFlag: '--description-file',
        });

        const result = await updateIssue(
          cliServiceContext(globalOpts, printWrittenIssue(globalOpts)),
          id,
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
          { comment: options.comment },
        );
        if (!result.changed) {
          console.error(
            `Issue #${id} already has these values; nothing changed.`,
          );
          console.log(formatIssueDetail(result.issue, globalOpts.output));
        }
      },
    );
}
