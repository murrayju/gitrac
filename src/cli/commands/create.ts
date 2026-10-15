import type { Command } from 'commander';
import { invalidInput } from '../../core/errors.ts';
import { parseLabelList } from '../../core/validate.ts';
import { createIssue } from '../../service/issues.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { cliServiceContext, printWrittenIssue } from '../service-context.ts';
import { resolveTextOption } from '../text-input.ts';

export function registerCreateCommand(program: Command): void {
  program
    .command('create')
    .alias('new')
    .alias('add')
    .description('Create a new issue')
    .option('-t, --title <title>', 'Issue title')
    .option('-p, --priority <priority>', 'Priority level')
    .option('-l, --labels <labels>', 'Comma-separated labels')
    .option('-a, --assignee <assignee>', 'Assignee')
    .option('-s, --status <status>', 'Initial status')
    .option('-d, --description <text>', 'Issue description (markdown)')
    .option(
      '--description-file <path>',
      'Read the description from a file (`-` for stdin)',
    )
    .action(
      async (options: {
        title?: string;
        priority?: string;
        labels?: string;
        assignee?: string;
        status?: string;
        description?: string;
        descriptionFile?: string;
      }) => {
        const globalOpts = await resolveProjectOptions(program);

        // Read the description (possibly from stdin) before taking the lock.
        const description = await resolveTextOption({
          inline: options.description,
          file: options.descriptionFile,
          inlineFlag: '--description',
          fileFlag: '--description-file',
        });

        let title = options.title;
        if (!title) {
          const prompted = prompt('Issue title: ');
          if (!prompted) {
            throw invalidInput('Title is required.');
          }
          title = prompted;
        }

        // Validates, allocates the ID, writes and commits under the repo lock
        // (so parallel creates can't collide).
        await createIssue(
          cliServiceContext(globalOpts, printWrittenIssue(globalOpts)),
          {
            title,
            status: options.status,
            priority: options.priority,
            assignee: options.assignee,
            description,
            labels:
              options.labels !== undefined
                ? parseLabelList(options.labels)
                : undefined,
          },
        );
      },
    );
}
