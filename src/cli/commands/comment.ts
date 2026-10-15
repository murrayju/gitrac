import type { Command } from 'commander';
import { invalidInput, parseIssueIdArg } from '../../core/errors.ts';
import { addComment } from '../../service/issues.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { cliServiceContext, printWrittenIssue } from '../service-context.ts';
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

      await addComment(
        cliServiceContext(globalOpts, printWrittenIssue(globalOpts)),
        id,
        commentBody,
      );
    });
}
