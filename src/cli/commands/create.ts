import type { Command } from 'commander';
import type {
  Issue,
  OutputFormat,
  Priority,
  Status,
} from '../../core/types.ts';
import {
  allocateNextId,
  readConfig,
  writeIssue,
} from '../../fs/issue-store.ts';
import { commitIssueChange, pushIfConfigured } from '../../git/operations.ts';
import { getGitRoot } from '../../git/status.ts';
import { formatIssueDetail } from '../output.ts';

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
    .action(
      async (options: {
        title?: string;
        priority?: string;
        labels?: string;
        assignee?: string;
        status?: string;
      }) => {
        const globalOpts = program.opts();
        const dir = globalOpts.dir || process.cwd();

        try {
          await getGitRoot(dir);
        } catch {
          console.error('Error: Not inside a git repository.');
          process.exit(1);
        }

        const config = await readConfig(dir);

        let title = options.title;
        if (!title) {
          const prompted = prompt('Issue title: ');
          if (!prompted) {
            console.error('Error: Title is required.');
            process.exit(1);
          }
          title = prompted;
        }

        const now = new Date().toISOString();
        const id = await allocateNextId(dir);

        // Get author name
        let author = globalOpts.author || '';
        if (!author) {
          try {
            const { default: simpleGit } = await import('simple-git');
            const git = simpleGit(dir);
            author = (await git.getConfig('user.name')).value || 'unknown';
          } catch {
            author = 'unknown';
          }
        }

        const issue: Issue = {
          id,
          title,
          status: (options.status as Status) || config.defaultStatus,
          priority: (options.priority as Priority) || config.defaultPriority,
          assignee: options.assignee || '',
          labels: options.labels
            ? options.labels.split(',').map((l) => l.trim())
            : [],
          created: now,
          createdBy: author,
          updated: now,
          description: '',
          comments: [],
        };

        const filename = await writeIssue(dir, issue);

        const format = (globalOpts.output || 'human') as OutputFormat;
        console.log(formatIssueDetail(issue, format));

        if (!globalOpts.noCommit && config.git.autoCommit) {
          await commitIssueChange(
            dir,
            [`.issues/${filename}`, '.issues/config.yaml'],
            `${config.git.commitPrefix} create #${id} ${title}`,
          );
          await pushIfConfigured(dir, config, {
            push: globalOpts.push,
            noPush: globalOpts.noPush,
          });
        }
      },
    );
}
