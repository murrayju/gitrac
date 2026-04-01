import { join } from 'node:path';
import type { Command } from 'commander';
import { findAssigneeByEmail } from '../../core/config.ts';
import type { OutputFormat } from '../../core/types.ts';
import {
  deleteIssueFile,
  findIssueFile,
  readConfig,
  readIssue,
  writeConfig,
  writeIssue,
} from '../../fs/issue-store.ts';
import { commitIssueChange, pushIfConfigured } from '../../git/operations.ts';
import { getGitRoot } from '../../git/status.ts';
import { formatIssueDetail } from '../output.ts';

export function registerClaimCommand(program: Command): void {
  program
    .command('claim <id>')
    .description('Claim an issue (assign to yourself and set in_progress)')
    .option('-c, --comment <text>', 'Add a comment when claiming')
    .action(async (idStr: string, options: { comment?: string }) => {
      const globalOpts = program.opts();
      const dir = globalOpts.dir || process.cwd();

      try {
        await getGitRoot(dir);
      } catch {
        console.error('Error: Not inside a git repository.');
        process.exit(1);
      }

      const config = await readConfig(dir);
      const id = Number.parseInt(idStr, 10);
      if (Number.isNaN(id)) {
        console.error('Error: Invalid issue ID.');
        process.exit(1);
      }

      // Get current user name and email
      let authorName = globalOpts.author || '';
      let authorEmail = '';
      if (!authorName) {
        try {
          const { default: simpleGit } = await import('simple-git');
          const git = simpleGit(dir);
          authorName = (await git.getConfig('user.name')).value || 'unknown';
          authorEmail = (await git.getConfig('user.email')).value || '';
        } catch {
          authorName = 'unknown';
        }
      }

      try {
        const found = await findIssueFile(dir, id);
        if (!found) {
          console.error(`Error: Issue #${id} not found.`);
          process.exit(1);
        }
        const wasClosed = found.closed;
        const oldFilename = found.filename;

        const issue = await readIssue(dir, id);
        // Use email as the canonical identifier if available, else fall back to name
        issue.assignee = authorEmail || authorName;
        issue.status = 'in_progress';

        // Add user to config.assignees if not already present (by email)
        let configChanged = false;
        if (
          authorEmail &&
          !findAssigneeByEmail(config.assignees, authorEmail)
        ) {
          config.assignees.push({ name: authorName, email: authorEmail });
          await writeConfig(dir, config);
          configChanged = true;
        }
        const now = new Date().toISOString();
        issue.updated = now;

        if (options.comment) {
          issue.comments.push({
            author: authorName,
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

        const format = (globalOpts.output || 'human') as OutputFormat;
        console.log(formatIssueDetail(issue, format));

        if (!globalOpts.noCommit && config.git.autoCommit) {
          const filesToCommit = [join('.issues', filename)];
          if (wasClosed) {
            filesToCommit.push(join('.issues', 'closed', oldFilename));
          }
          if (configChanged) {
            filesToCommit.push(join('.issues', 'config.yaml'));
          }
          await commitIssueChange(
            dir,
            filesToCommit,
            `${config.git.commitPrefix} claim #${id} ${issue.title}`,
          );
          await pushIfConfigured(dir, config, {
            push: globalOpts.push,
            noPush: globalOpts.noPush,
          });
        }
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });
}
