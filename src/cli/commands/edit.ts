import type { Command } from 'commander';
import { parseIssueIdArg } from '../../core/errors.ts';
import { parseLabelList } from '../../core/validate.ts';
import { updateIssue } from '../../service/issues.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { cliServiceContext, printWrittenIssue } from '../service-context.ts';
import { resolveTextOption } from '../text-input.ts';

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

        const id = parseIssueIdArg(idStr);

        // Read the description (possibly from stdin) before taking the lock.
        const newDescription = await resolveTextOption({
          inline: options.description,
          file: options.descriptionFile,
          inlineFlag: '--description',
          fileFlag: '--description-file',
        });

        await updateIssue(
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
      },
    );
}
