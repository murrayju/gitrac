import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import { parseIssue } from '../../core/issue.ts';
import type { Issue, OutputFormat } from '../../core/types.ts';
import {
  listClosedIssueFiles,
  listIssueFiles,
  readConfig,
} from '../../fs/issue-store.ts';
import { getBranchWarning, getGitRoot } from '../../git/status.ts';
import { formatIssueList } from '../output.ts';

async function loadIssues(
  dir: string,
  filenames: string[],
  subdir: string,
): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const filename of filenames) {
    const content = await readFile(
      join(dir, '.issues', subdir, filename),
      'utf-8',
    );
    issues.push(parseIssue(content));
  }
  return issues;
}

function sortIssues(issues: Issue[], sortBy: string): Issue[] {
  const sorted = [...issues];
  switch (sortBy) {
    case 'id':
      sorted.sort((a, b) => a.id - b.id);
      break;
    case 'priority': {
      const order = ['urgent', 'high', 'medium', 'low', 'none'];
      sorted.sort(
        (a, b) => order.indexOf(a.priority) - order.indexOf(b.priority),
      );
      break;
    }
    case 'status': {
      const order = ['in_progress', 'todo', 'backlog', 'done', 'cancelled'];
      sorted.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
      break;
    }
    case 'updated':
      sorted.sort(
        (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime(),
      );
      break;
    default:
      sorted.sort((a, b) => a.id - b.id);
  }
  return sorted;
}

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('List issues')
    .option('--status <status>', 'Filter by status (or "all")')
    .option('--assignee <assignee>', 'Filter by assignee')
    .option('--label <label>', 'Filter by label')
    .option('--priority <priority>', 'Filter by priority')
    .option(
      '--sort <field>',
      'Sort by field (id, priority, status, updated)',
      'id',
    )
    .action(
      async (options: {
        status?: string;
        assignee?: string;
        label?: string;
        priority?: string;
        sort?: string;
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

        // Print branch warning
        const warning = await getBranchWarning(dir, config);
        if (warning) {
          console.warn(`Warning: ${warning}`);
        }

        let issues: Issue[] = [];

        const closedStatuses = ['done', 'cancelled'];
        const statusFilter = options.status;

        if (statusFilter === 'all') {
          // Load from both directories
          const [openFiles, closedFiles] = await Promise.all([
            listIssueFiles(dir),
            listClosedIssueFiles(dir),
          ]);
          const [openIssues, closedIssues] = await Promise.all([
            loadIssues(dir, openFiles, ''),
            loadIssues(dir, closedFiles, 'closed'),
          ]);
          issues = [...openIssues, ...closedIssues];
        } else if (statusFilter && closedStatuses.includes(statusFilter)) {
          // Search both dirs since a done/cancelled issue might not be moved yet
          const [openFiles, closedFiles] = await Promise.all([
            listIssueFiles(dir),
            listClosedIssueFiles(dir),
          ]);
          const [openIssues, closedIssues] = await Promise.all([
            loadIssues(dir, openFiles, ''),
            loadIssues(dir, closedFiles, 'closed'),
          ]);
          issues = [...openIssues, ...closedIssues];
        } else {
          // Default: open issues only
          const openFiles = await listIssueFiles(dir);
          issues = await loadIssues(dir, openFiles, '');
        }

        // Apply filters
        if (statusFilter && statusFilter !== 'all') {
          issues = issues.filter((i) => i.status === statusFilter);
        }
        if (options.assignee) {
          issues = issues.filter((i) => i.assignee === options.assignee);
        }
        if (options.label) {
          issues = issues.filter((i) =>
            i.labels.includes(options.label as string),
          );
        }
        if (options.priority) {
          issues = issues.filter((i) => i.priority === options.priority);
        }

        // Sort
        issues = sortIssues(issues, options.sort || 'id');

        const format = (globalOpts.output || 'human') as OutputFormat;
        console.log(formatIssueList(issues, format));
      },
    );
}
