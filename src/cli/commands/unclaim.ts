import { join } from 'node:path';
import type { Command } from 'commander';
import {
  decideUnclaim,
  EXIT_ALREADY_CLAIMED,
  EXIT_ISSUE_CLOSED,
} from '../../core/claim.ts';
import {
  GitracError,
  issueNotFound,
  parseIssueIdArg,
} from '../../core/errors.ts';
import {
  deleteIssueFile,
  findIssueFile,
  readConfig,
  readIssue,
  writeIssue,
} from '../../fs/issue-store.ts';
import {
  commitAndMaybePush,
  resolveProjectOptions,
  withMutationLock,
} from '../global-options.ts';
import { formatIssueDetail } from '../output.ts';
import { resolveClaimUser } from './claim.ts';

export function registerUnclaimCommand(program: Command): void {
  program
    .command('unclaim <id>')
    .alias('release')
    .description(
      'Give an issue back: clear the assignee and move in_progress back to todo. ' +
        `Exits ${EXIT_ALREADY_CLAIMED} if someone else has it (override with --force), ` +
        `${EXIT_ISSUE_CLOSED} if it is closed.`,
    )
    .option('-c, --comment <text>', 'Add a comment when releasing')
    .option('-f, --force', 'Release an issue claimed by someone else')
    .action(
      async (idStr: string, options: { comment?: string; force?: boolean }) => {
        const globalOpts = await resolveProjectOptions(program);
        const { dir } = globalOpts;
        const id = parseIssueIdArg(idStr);
        const user = await resolveClaimUser(globalOpts);

        await withMutationLock(globalOpts, async () => {
          const config = await readConfig(dir);
          const found = await findIssueFile(dir, id);
          if (!found) throw issueNotFound(id);
          const issue = await readIssue(dir, id);

          const decision = decideUnclaim(issue, user, {
            force: options.force,
            inClosedDir: found.closed,
          });
          if (decision.action === 'not-yours') {
            throw new GitracError(
              'already_claimed',
              `Issue #${id} is claimed by ${decision.assignee}, not you. Use --force to release it anyway.`,
              { details: { id, assignee: decision.assignee } },
            );
          }
          if (decision.action === 'closed') {
            throw new GitracError(
              'issue_closed',
              `Issue #${id} is closed (${issue.status}); nothing to release.`,
              { details: { id, status: issue.status } },
            );
          }
          if (decision.action === 'noop') {
            console.error(
              options.comment
                ? `Issue #${id} is not claimed; nothing changed (comment not added; use "gitrac comment").`
                : `Issue #${id} is not claimed; nothing changed.`,
            );
            console.log(formatIssueDetail(issue, globalOpts.output));
            return;
          }

          issue.assignee = '';
          if (issue.status === 'in_progress') {
            issue.status = 'todo';
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

          const filename = await writeIssue(dir, issue);
          const filesToCommit = [join('.issues', filename)];
          if (filename !== found.filename) {
            // The on-disk filename didn't match the title's slug; replace it.
            await deleteIssueFile(dir, found.filename, false);
            filesToCommit.push(join('.issues', found.filename));
          }

          console.log(formatIssueDetail(issue, globalOpts.output));

          await commitAndMaybePush(
            globalOpts,
            config,
            filesToCommit,
            `${config.git.commitPrefix} unclaim #${id} ${issue.title}`,
          );
        });
      },
    );
}
