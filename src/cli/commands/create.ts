import type { Command } from 'commander';
import { invalidInput } from '../../core/errors.ts';
import { parseLabelList } from '../../core/validate.ts';
import { createIssue } from '../../service/issues.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { type PromptStreams, promptLine, stdinIsTTY } from '../prompt.ts';
import { cliServiceContext, printWrittenIssue } from '../service-context.ts';
import { resolveTextOption } from '../text-input.ts';

/**
 * The title for `create` without `-t`: asked on stderr when stdin is a
 * terminal; otherwise (agents, scripts, piped stdin) an `invalid_input`
 * error rather than a hidden prompt.
 */
export async function askTitle(
  isTTY: () => boolean = stdinIsTTY,
  streams?: PromptStreams,
): Promise<string> {
  if (!isTTY()) {
    throw invalidInput(
      'Title is required: pass -t, --title <title> (stdin is not a terminal, so it was not asked for).',
    );
  }
  const title = (await promptLine('Issue title:', streams))?.trim();
  if (!title) throw invalidInput('Title is required.');
  return title;
}

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

        const title = options.title || (await askTitle());

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
