import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { parseIssue } from '../../core/issue.ts';
import type { Issue, Status } from '../../core/types.ts';
import {
  allocateNextId,
  findIssueFile,
  listClosedIssueFiles,
  listIssueFiles,
  moveToClose,
  moveToReopen,
  readConfig,
  readIssue,
  writeIssue,
} from '../../fs/issue-store.ts';
import { commitIssueChange } from '../../git/operations.ts';
import type { ServerContext } from '../server.ts';

const CLOSED_STATUSES: Status[] = ['done', 'cancelled'];

export function issueRoutes(ctx: ServerContext): Hono {
  const app = new Hono();

  // GET /issues — list issues with optional filters
  app.get('/issues', async (c) => {
    const { dir } = ctx;

    const statusFilter = c.req.query('status');
    const assignee = c.req.query('assignee');
    const label = c.req.query('label');
    const priority = c.req.query('priority');
    const sort = c.req.query('sort');

    let issues: Issue[] = [];

    if (statusFilter === 'all') {
      const [openFiles, closedFiles] = await Promise.all([
        listIssueFiles(dir),
        listClosedIssueFiles(dir),
      ]);
      const openIssues = await loadIssues(openFiles, join(dir, '.issues'));
      const closedIssues = await loadIssues(
        closedFiles,
        join(dir, '.issues', 'closed'),
      );
      issues = [...openIssues, ...closedIssues];
    } else if (
      statusFilter &&
      CLOSED_STATUSES.includes(statusFilter as Status)
    ) {
      const closedFiles = await listClosedIssueFiles(dir);
      const closedIssues = await loadIssues(
        closedFiles,
        join(dir, '.issues', 'closed'),
      );
      issues = closedIssues.filter((i) => i.status === statusFilter);
    } else if (statusFilter) {
      const openFiles = await listIssueFiles(dir);
      const openIssues = await loadIssues(openFiles, join(dir, '.issues'));
      issues = openIssues.filter((i) => i.status === statusFilter);
    } else {
      const openFiles = await listIssueFiles(dir);
      issues = await loadIssues(openFiles, join(dir, '.issues'));
    }

    // Apply filters
    if (assignee) {
      issues = issues.filter((i) => i.assignee === assignee);
    }
    if (label) {
      issues = issues.filter((i) => i.labels.includes(label));
    }
    if (priority) {
      issues = issues.filter((i) => i.priority === priority);
    }

    // Apply sorting
    if (sort) {
      issues = sortIssues(issues, sort);
    }

    return c.json(issues);
  });

  // GET /issues/:id — get a single issue
  app.get('/issues/:id', async (c) => {
    const { dir } = ctx;
    const id = Number.parseInt(c.req.param('id'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }

    try {
      const issue = await readIssue(dir, id);
      return c.json(issue);
    } catch {
      return c.json({ error: `Issue #${id} not found` }, 404);
    }
  });

  // POST /issues — create a new issue
  app.post('/issues', async (c) => {
    const { dir, config, amendTracker } = ctx;

    const body = await c.req.json();
    const { title, priority, labels, assignee, status, description } = body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return c.json({ error: 'title is required' }, 400);
    }

    const id = await allocateNextId(dir);
    const now = new Date().toISOString();

    const issue: Issue = {
      id,
      title: title.trim(),
      status: status ?? config.defaultStatus,
      priority: priority ?? config.defaultPriority,
      assignee: assignee ?? '',
      labels: labels ?? [],
      created: now,
      createdBy: 'web',
      updated: now,
      description: description ?? '',
      comments: [],
    };

    const filename = await writeIssue(dir, issue);

    if (config.git.autoCommit) {
      const prefix = config.git.commitPrefix;
      const message = `${prefix} create #${id} ${issue.title}`;
      const hash = await commitIssueChange(
        dir,
        [join('.issues', filename), join('.issues', 'config.yaml')],
        message,
      );
      if (hash) {
        amendTracker.record(id, hash);
      }
    }

    return c.json(issue, 201);
  });

  // PATCH /issues/:id — update issue metadata
  app.patch('/issues/:id', async (c) => {
    const { dir, config, amendTracker } = ctx;
    const id = Number.parseInt(c.req.param('id'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }

    let issue: Issue;
    try {
      issue = await readIssue(dir, id);
    } catch {
      return c.json({ error: `Issue #${id} not found` }, 404);
    }

    const body = await c.req.json();
    const { title, priority, labels, assignee, status, description } = body;

    if (title !== undefined) issue.title = title;
    if (priority !== undefined) issue.priority = priority;
    if (labels !== undefined) issue.labels = labels;
    if (assignee !== undefined) issue.assignee = assignee;
    if (status !== undefined) issue.status = status;
    if (description !== undefined) issue.description = description;
    issue.updated = new Date().toISOString();

    const filename = await writeIssue(dir, issue);

    if (config.git.autoCommit) {
      const prefix = config.git.commitPrefix;
      const message = `${prefix} update #${id} ${issue.title}`;
      const canAmend = await amendTracker.canAmend(dir, id);
      if (canAmend) {
        const hash = await amendTracker.amend(
          dir,
          [join('.issues', filename)],
          message,
        );
        amendTracker.record(id, hash);
      } else {
        const hash = await commitIssueChange(
          dir,
          [join('.issues', filename)],
          message,
        );
        if (hash) {
          amendTracker.record(id, hash);
        }
      }
    }

    return c.json(issue);
  });

  // POST /issues/:id/comments — add a comment
  app.post('/issues/:id/comments', async (c) => {
    const { dir, config, amendTracker } = ctx;
    const id = Number.parseInt(c.req.param('id'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }

    let issue: Issue;
    try {
      issue = await readIssue(dir, id);
    } catch {
      return c.json({ error: `Issue #${id} not found` }, 404);
    }

    const body = await c.req.json();
    const { body: commentBody, author } = body;

    if (
      !commentBody ||
      typeof commentBody !== 'string' ||
      !commentBody.trim()
    ) {
      return c.json({ error: 'body is required' }, 400);
    }

    issue.comments.push({
      author: author ?? 'web',
      timestamp: new Date().toISOString(),
      body: commentBody.trim(),
    });
    issue.updated = new Date().toISOString();

    const filename = await writeIssue(dir, issue);

    if (config.git.autoCommit) {
      const prefix = config.git.commitPrefix;
      const message = `${prefix} comment on #${id} ${issue.title}`;
      const hash = await commitIssueChange(
        dir,
        [join('.issues', filename)],
        message,
      );
      if (hash) {
        amendTracker.record(id, hash);
      }
    }

    return c.json(issue);
  });

  // PATCH /issues/:id/close — close an issue
  app.patch('/issues/:id/close', async (c) => {
    const { dir, config, amendTracker } = ctx;
    const id = Number.parseInt(c.req.param('id'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }

    let issue: Issue;
    try {
      issue = await readIssue(dir, id);
    } catch {
      return c.json({ error: `Issue #${id} not found` }, 404);
    }

    issue.status = 'done';
    issue.updated = new Date().toISOString();

    // Write updated issue then move to closed
    const filename = await writeIssue(dir, issue);
    await moveToClose(dir, id);

    if (config.git.autoCommit) {
      const prefix = config.git.commitPrefix;
      const message = `${prefix} close #${id} ${issue.title}`;
      const hash = await commitIssueChange(
        dir,
        [join('.issues', filename), join('.issues', 'closed', filename)],
        message,
      );
      if (hash) {
        amendTracker.record(id, hash);
      }
    }

    return c.json(issue);
  });

  // PATCH /issues/:id/reopen — reopen a closed issue
  app.patch('/issues/:id/reopen', async (c) => {
    const { dir, config, amendTracker } = ctx;
    const id = Number.parseInt(c.req.param('id'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }

    let issue: Issue;
    try {
      issue = await readIssue(dir, id);
    } catch {
      return c.json({ error: `Issue #${id} not found` }, 404);
    }

    const currentConfig = await readConfig(dir);
    issue.status = currentConfig.defaultStatus;
    issue.updated = new Date().toISOString();

    // Move from closed back to open if needed
    const found = await findIssueFile(dir, id);
    if (found?.closed) {
      await moveToReopen(dir, id);
    }

    const filename = await writeIssue(dir, issue);

    if (config.git.autoCommit) {
      const prefix = config.git.commitPrefix;
      const message = `${prefix} reopen #${id} ${issue.title}`;
      const hash = await commitIssueChange(
        dir,
        [join('.issues', filename), join('.issues', 'closed', filename)],
        message,
      );
      if (hash) {
        amendTracker.record(id, hash);
      }
    }

    return c.json(issue);
  });

  return app;
}

async function loadIssues(files: string[], baseDir: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const f of files) {
    try {
      const content = await readFile(join(baseDir, f), 'utf-8');
      issues.push(parseIssue(content));
    } catch {
      // Skip unreadable files
    }
  }
  return issues;
}

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

function sortIssues(issues: Issue[], sort: string): Issue[] {
  const sorted = [...issues];
  switch (sort) {
    case 'priority':
      sorted.sort(
        (a, b) =>
          (PRIORITY_ORDER[a.priority] ?? 99) -
          (PRIORITY_ORDER[b.priority] ?? 99),
      );
      break;
    case 'created':
      sorted.sort(
        (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime(),
      );
      break;
    case 'updated':
      sorted.sort(
        (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime(),
      );
      break;
    case 'id':
      sorted.sort((a, b) => a.id - b.id);
      break;
    default:
      break;
  }
  return sorted;
}
