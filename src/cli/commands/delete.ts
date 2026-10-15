import type { Command } from 'commander';
import yaml from 'js-yaml';
import { GitracError, parseIssueIdArg } from '../../core/errors.ts';
import type { OutputFormat } from '../../core/types.ts';
import { deleteIssue, type IssueDeletion } from '../../service/delete.ts';
import {
  type GlobalOptions,
  resolveProjectOptions,
} from '../global-options.ts';
import { cliServiceContext } from '../service-context.ts';

/** `gitrac delete` options. */
export interface DeleteOptions {
  yes?: boolean;
  dryRun?: boolean;
}

/** Terminal interaction, injectable for tests. */
export interface DeleteIO {
  /** Whether stdin is an interactive terminal (so we may ask). */
  isTTY: () => boolean;
  /** Ask a question; returns the answer, or null on EOF. */
  prompt: (question: string) => string | null;
}

const defaultIO: DeleteIO = {
  isTTY: () => Boolean(process.stdin.isTTY),
  prompt: (question) => prompt(question),
};

/** What a deletion removes (or would). */
type DeletionSummary = Pick<IssueDeletion, 'issue' | 'paths' | 'assets'>;

/** Format a deletion (done or planned) in the `-o` format. */
export function formatDeletion(
  plan: DeletionSummary,
  deleted: boolean,
  format: OutputFormat,
): string {
  const data = {
    deleted,
    issue: plan.issue,
    paths: plan.paths,
    assets: plan.assets,
  };
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'yaml':
      return yaml.dump(data, { lineWidth: -1 });
    case 'human':
      return [
        `${deleted ? 'Deleted' : 'Would delete'} #${plan.issue.id}: ${plan.issue.title}`,
        ...plan.paths.map((p) => `  ${p}`),
      ].join('\n');
  }
}

/**
 * Delete issue `id`. Without `--yes`, shows what would be deleted and asks
 * for confirmation on a terminal; when stdin isn't a terminal (agents,
 * scripts) it prints the plan and fails with `confirmation_required` (exit 2)
 * instead. `--dry-run` only prints the plan. The prompt runs outside the repo
 * lock; the deletion then refuses (`invalid_state`) if the issue changed in
 * between.
 */
export async function runDelete(
  globalOpts: GlobalOptions,
  id: number,
  options: DeleteOptions,
  io: DeleteIO = defaultIO,
): Promise<IssueDeletion> {
  const print = (plan: DeletionSummary, deleted: boolean) =>
    console.log(formatDeletion(plan, deleted, globalOpts.output));

  let confirmedContent: string | undefined;
  if (options.dryRun || !options.yes) {
    const plan = await deleteIssue(cliServiceContext(globalOpts), id, {
      dryRun: true,
      precondition: (stored) => {
        confirmedContent = stored.content;
      },
    });
    if (options.dryRun) {
      print(plan, false);
      return plan;
    }
    if (!io.isTTY()) {
      print(plan, false);
      throw new GitracError(
        'confirmation_required',
        `Refusing to delete issue #${id} without confirmation (stdin is not a terminal). Re-run with --yes to delete.`,
        { details: { id, paths: plan.paths } },
      );
    }
    print(plan, false);
    const answer = io.prompt(`Delete issue #${id}? [y/N]`);
    if (!answer || !/^y(es)?$/i.test(answer.trim())) {
      throw new GitracError(
        'confirmation_required',
        `Not confirmed; issue #${id} was not deleted.`,
        { details: { id } },
      );
    }
  }

  return deleteIssue(
    cliServiceContext(globalOpts, ({ issue, paths }) => {
      if (!issue) return;
      // The issue file comes first, then the orphaned assets.
      print({ issue, paths, assets: paths.slice(1) }, true);
    }),
    id,
    {
      precondition: (stored) => {
        if (
          confirmedContent !== undefined &&
          stored.content !== confirmedContent
        ) {
          throw new GitracError(
            'invalid_state',
            `Issue #${id} changed while waiting for confirmation; nothing was deleted. Run the command again.`,
            { details: { id } },
          );
        }
      },
    },
  );
}

export function registerDeleteCommand(program: Command): void {
  program
    .command('delete <id>')
    .alias('rm')
    .description(
      'Delete an issue (its file and any assets only it references) and commit the removal. ' +
        'Asks for confirmation; without a terminal, requires --yes.',
    )
    .option('-y, --yes', 'Delete without asking for confirmation')
    .option('--dry-run', 'Only show what would be deleted')
    .action(async (idStr: string, options: DeleteOptions) => {
      const globalOpts = await resolveProjectOptions(program);
      const id = parseIssueIdArg(idStr);
      await runDelete(globalOpts, id, options);
    });
}
