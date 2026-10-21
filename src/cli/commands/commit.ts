import type { Command } from 'commander';
import yaml from 'js-yaml';
import {
  EXIT_ALREADY_CLAIMED,
  EXIT_GIT,
  EXIT_INVALID_INPUT,
  GitracError,
  parseIssueIdArg,
} from '../../core/errors.ts';
import type { OutputFormat } from '../../core/types.ts';
import {
  type CommitClose,
  closeWithCommit,
} from '../../service/commit-close.ts';
import { withHint } from '../errors.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { cliServiceContext } from '../service-context.ts';

/** Format the result of `gitrac commit` in the `-o` format. */
export function formatCommitClose(
  result: Pick<CommitClose, 'issue' | 'commit'>,
  format: OutputFormat,
): string {
  const data = { issue: result.issue, commit: result.commit };
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'yaml':
      return yaml.dump(data, { lineWidth: -1 }).trimEnd();
    case 'human':
      return `Closed #${result.issue.id} (${result.issue.status}) in ${result.commit.slice(0, 7)}`;
  }
}

/** CLI hints for the `invalid_input` errors of `closeWithCommit`, by reason. */
const INPUT_HINTS: Record<string, string> = {
  pathspec: 'Stage the files with git add (or pass -- -a) instead.',
  nothing_staged:
    'Stage your changes (git add), pass -- -a, or use gitrac close to commit only the issue.',
};

export function registerCommitCommand(program: Command): void {
  program
    .command('commit <id>')
    .argument('[git-args...]', 'Arguments for git commit (after --)')
    .usage('<id> [options] [-- <git commit args>]')
    .description(
      'Close an issue and run git commit, so the close goes into the same commit as your staged changes. ' +
        'Everything after -- goes to git commit (e.g. -- -m "fix: ... (#<id>)"); without -m git opens the editor. ' +
        `Exits ${EXIT_INVALID_INPUT} if nothing besides the issue is staged (pass -- -a to commit all tracked changes) ` +
        `or git commit is given pathspecs, ${EXIT_ALREADY_CLAIMED} if someone else has claimed the issue (override with --force), ` +
        `${EXIT_GIT} if git commit fails or makes no commit (then the issue is left as it was).`,
    )
    .option(
      '--cancelled',
      'Close with the configured cancel status (default: cancelled)',
    )
    .option(
      '-s, --status <status>',
      'Closed status to set (default: config closeStatus, i.e. done)',
    )
    .option('-c, --comment <text>', 'Add a comment when closing')
    .option('-f, --force', 'Close even if someone else has claimed the issue')
    .action(
      async (
        idStr: string,
        gitArgs: string[],
        options: {
          cancelled?: boolean;
          status?: string;
          comment?: string;
          force?: boolean;
        },
      ) => {
        const globalOpts = await resolveProjectOptions(program);
        if (!globalOpts.commit) {
          throw new GitracError(
            'usage',
            '--no-commit cannot be used with commit. Use gitrac close --no-commit to close without committing.',
          );
        }
        const id = parseIssueIdArg(idStr);
        const format = globalOpts.output;

        await closeWithCommit(cliServiceContext(globalOpts), id, {
          cancelled: options.cancelled,
          status: options.status,
          comment: options.comment,
          force: options.force,
          gitArgs,
          // Keep stdout for the result in json/yaml mode.
          gitStdout: format === 'human' ? 'stdout' : 'stderr',
          onCommitted: (result) =>
            console.log(formatCommitClose(result, format)),
        }).catch((err: unknown) => {
          const reason =
            err instanceof GitracError ? err.details?.reason : undefined;
          const inputHint =
            typeof reason === 'string' ? INPUT_HINTS[reason] : undefined;
          throw withHint(err, {
            already_claimed: 'Use --force to close it anyway.',
            ...(inputHint ? { invalid_input: inputHint } : {}),
          });
        });
      },
    );
}
