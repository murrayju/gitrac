import { join } from 'node:path';
import type { Command } from 'commander';
import {
  type ClaimUser,
  claimAssignee,
  decideClaim,
  EXIT_ALREADY_CLAIMED,
  EXIT_ISSUE_CLOSED,
} from '../../core/claim.ts';
import { findAssigneeByEmail } from '../../core/config.ts';
import {
  deleteIssueFile,
  findIssueFile,
  readConfig,
  readIssue,
  writeConfig,
  writeIssue,
} from '../../fs/issue-store.ts';
import type { GlobalOptions } from '../global-options.ts';
import {
  commitAndMaybePush,
  resolveProjectOptions,
  withMutationLock,
} from '../global-options.ts';
import { formatIssueDetail } from '../output.ts';

/** Parse an issue ID argument, exiting 1 if it isn't a number. */
export function parseIssueIdArg(idStr: string): number {
  const id = Number.parseInt(idStr, 10);
  if (Number.isNaN(id)) {
    console.error('Error: Invalid issue ID.');
    process.exit(1);
  }
  return id;
}

/**
 * Resolve the current user: `--author` (name only) or git `user.name` /
 * `user.email`.
 */
export async function resolveClaimUser(
  globalOpts: GlobalOptions,
): Promise<ClaimUser> {
  if (globalOpts.author) {
    return { name: globalOpts.author, email: '' };
  }
  try {
    const { default: simpleGit } = await import('simple-git');
    const git = simpleGit(globalOpts.dir);
    return {
      name: (await git.getConfig('user.name')).value || 'unknown',
      email: (await git.getConfig('user.email')).value || '',
    };
  } catch {
    return { name: 'unknown', email: '' };
  }
}

export function registerClaimCommand(program: Command): void {
  program
    .command('claim <id>')
    .description(
      'Claim an issue (assign to yourself and set in_progress). ' +
        `Exits ${EXIT_ALREADY_CLAIMED} if someone else has it, ` +
        `${EXIT_ISSUE_CLOSED} if it is closed (override with --force).`,
    )
    .option('-c, --comment <text>', 'Add a comment when claiming')
    .option(
      '-f, --force',
      'Take over an issue claimed by someone else, or reopen and claim a closed issue',
    )
    .action(
      async (idStr: string, options: { comment?: string; force?: boolean }) => {
        const globalOpts = await resolveProjectOptions(program);
        const { dir } = globalOpts;
        const id = parseIssueIdArg(idStr);
        const user = await resolveClaimUser(globalOpts);

        await withMutationLock(globalOpts, async () => {
          const config = await readConfig(dir);
          try {
            const found = await findIssueFile(dir, id);
            if (!found) {
              console.error(`Error: Issue #${id} not found.`);
              process.exit(1);
            }
            const wasClosed = found.closed;
            const oldFilename = found.filename;

            const issue = await readIssue(dir, id);

            // The exclusivity check must happen under the lock, on the
            // freshly-read issue, so two concurrent claims can't both win.
            const decision = decideClaim(issue, user, {
              force: options.force,
              inClosedDir: wasClosed,
            });
            if (decision.action === 'already-claimed') {
              console.error(
                `Error: Issue #${id} is already claimed by ${decision.assignee} (in_progress). Use --force to take it over.`,
              );
              process.exit(EXIT_ALREADY_CLAIMED);
            }
            if (decision.action === 'closed') {
              console.error(
                `Error: Issue #${id} is closed (${issue.status}). Use "gitrac reopen ${id}" first, or claim --force to reopen and claim it.`,
              );
              process.exit(EXIT_ISSUE_CLOSED);
            }
            if (decision.action === 'noop') {
              console.error(
                options.comment
                  ? `Issue #${id} is already claimed by you; nothing changed (comment not added; use "gitrac comment").`
                  : `Issue #${id} is already claimed by you; nothing changed.`,
              );
              console.log(formatIssueDetail(issue, globalOpts.output));
              return;
            }

            // Use email as the canonical identifier if available, else fall back to name
            issue.assignee = claimAssignee(user);
            issue.status = 'in_progress';

            // Add user to config.assignees if not already present (by email)
            let configChanged = false;
            if (
              user.email &&
              !findAssigneeByEmail(config.assignees, user.email)
            ) {
              config.assignees.push({ name: user.name, email: user.email });
              await writeConfig(dir, config);
              configChanged = true;
            }
            const now = new Date().toISOString();
            issue.updated = now;

            if (options.comment) {
              issue.comments.push({
                author: user.name,
                timestamp: now,
                body: options.comment,
              });
            }

            // Claiming always sets in_progress (not a closed status), so write to open dir
            const filename = await writeIssue(dir, issue);

            // If issue was in closed dir, clean up the old file
            if (wasClosed) {
              await deleteIssueFile(dir, oldFilename, true);
            }

            console.log(formatIssueDetail(issue, globalOpts.output));

            const filesToCommit = [join('.issues', filename)];
            if (wasClosed) {
              filesToCommit.push(join('.issues', 'closed', oldFilename));
            }
            if (configChanged) {
              filesToCommit.push(join('.issues', 'config.yaml'));
            }
            await commitAndMaybePush(
              globalOpts,
              config,
              filesToCommit,
              `${config.git.commitPrefix} claim #${id} ${issue.title}`,
            );
          } catch (err) {
            console.error(
              `Error: ${err instanceof Error ? err.message : String(err)}`,
            );
            process.exit(1);
          }
        });
      },
    );
}
