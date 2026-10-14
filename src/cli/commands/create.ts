import type { Command } from 'commander';
import type { Issue } from '../../core/types.ts';
import {
  parseLabelList,
  validateIssue,
  validateIssueFields,
} from '../../core/validate.ts';
import {
  allocateNextId,
  readConfig,
  registerLabels,
  writeIssue,
} from '../../fs/issue-store.ts';
import {
  commitAndMaybePush,
  resolveProjectOptions,
  withMutationLock,
} from '../global-options.ts';
import { formatIssueDetail } from '../output.ts';
import { exitWithErrors } from '../validation.ts';

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
        const globalOpts = await resolveProjectOptions(program);
        const { dir } = globalOpts;

        let title = options.title;
        if (!title) {
          const prompted = prompt('Issue title: ');
          if (!prompted) {
            console.error('Error: Title is required.');
            process.exit(1);
          }
          title = prompted;
        }

        // Get author name
        let author = globalOpts.author;
        if (!author) {
          try {
            const { default: simpleGit } = await import('simple-git');
            const git = simpleGit(dir);
            author = (await git.getConfig('user.name')).value || 'unknown';
          } catch {
            author = 'unknown';
          }
        }

        // Allocate the ID, write the file and commit under the repo lock so
        // parallel creates can't collide.
        await withMutationLock(globalOpts, async () => {
          const config = await readConfig(dir);

          // Validate before touching disk (allocating the ID bumps nextId).
          const fields = validateIssueFields(
            {
              title,
              status: options.status,
              priority: options.priority,
              assignee: options.assignee,
              labels:
                options.labels !== undefined
                  ? parseLabelList(options.labels)
                  : undefined,
            },
            config,
            { requireTitle: true },
          );
          if (!fields.valid) exitWithErrors(fields.errors);
          const values = fields.values;

          const now = new Date().toISOString();
          const issue: Issue = {
            id: 0,
            title: values.title ?? '',
            status: values.status ?? config.defaultStatus,
            priority: values.priority ?? config.defaultPriority,
            assignee: values.assignee ?? '',
            labels: values.labels ?? [],
            created: now,
            createdBy: author,
            updated: now,
            description: '',
            comments: [],
          };
          // Final gate on the assembled issue (e.g. config defaults that
          // aren't in the configured statuses/priorities).
          const check = validateIssue({ ...issue, id: 1 }, config);
          if (!check.valid) exitWithErrors(check.errors);

          const id = await allocateNextId(dir);
          issue.id = id;

          const filename = await writeIssue(dir, issue);
          // Unknown labels are registered in config.yaml with a color, the
          // same as the web UI does.
          await registerLabels(dir, issue.labels);

          const format = globalOpts.output;
          console.log(formatIssueDetail(issue, format));

          await commitAndMaybePush(
            globalOpts,
            config,
            [`.issues/${filename}`, '.issues/config.yaml'],
            `${config.git.commitPrefix} create #${id} ${issue.title}`,
          );
        });
      },
    );
}
