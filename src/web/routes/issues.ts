import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Context, Hono } from 'hono';
import { extractAssetRefs } from '../../core/assets.ts';
import { GitracError } from '../../core/errors.ts';
import { parseIssue } from '../../core/issue.ts';
import {
  assertCanClose,
  assertCanReopen,
  reopenStatus,
} from '../../core/lifecycle.ts';
import { issueFilename } from '../../core/slug.ts';
import type { Issue } from '../../core/types.ts';
import { isClosedStatus, type Status } from '../../core/types.ts';
import { validateIssue, validateIssueFields } from '../../core/validate.ts';
import {
  allocateNextId,
  deleteIssueFile,
  listClosedIssueFiles,
  listIssueFiles,
  readConfig,
  readIssueContent,
  registerLabels,
  relocateIssue,
  writeIssue,
} from '../../fs/issue-store.ts';
import { commitIssueChange } from '../../git/operations.ts';
import { ifMatchSatisfied, issueETag } from '../etag.ts';
import { mutationLock } from '../lock.ts';
import type { ServerContext } from '../server.ts';
import { resolveAuthor } from './identity.ts';

/**
 * Ensure any new labels used on an issue get assigned colors in the config.
 * Returns the list of extra files to include in the git commit if config was updated.
 */
async function syncLabelColors(
  ctx: ServerContext,
  labels: string[],
): Promise<string[]> {
  const updated = await registerLabels(ctx.dir, labels);
  if (!updated) return [];
  ctx.config = updated;
  return [join('.issues', 'config.yaml')];
}

/** 400 response listing every validation error. */
function validationError(c: Context, errors: string[]): Response {
  return c.json({ error: errors.join('; '), errors }, 400);
}

/** Treat a non-object JSON body as empty so field checks reject it. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Parse a JSON request body, returning undefined if it isn't valid JSON. */
async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/** An issue as currently on disk, with its version (ETag) and location. */
interface LoadedIssue {
  issue: Issue;
  etag: string;
  filename: string;
  closed: boolean;
}

/** Read + parse an issue and compute its ETag; null if missing/unreadable. */
async function loadIssue(dir: string, id: number): Promise<LoadedIssue | null> {
  try {
    const raw = await readIssueContent(dir, id);
    if (!raw) return null;
    return {
      issue: parseIssue(raw.content),
      etag: issueETag(raw.content),
      filename: raw.filename,
      closed: raw.closed,
    };
  } catch {
    return null;
  }
}

/**
 * Optimistic concurrency: if the request carries an `If-Match` that doesn't
 * match the issue's current ETag, return a 409 with the current issue (and
 * its ETag) so the client can reconcile. Returns null when the write may
 * proceed. Must be called while holding the mutation lock.
 */
function preconditionFailed(c: Context, loaded: LoadedIssue): Response | null {
  if (ifMatchSatisfied(c.req.header('If-Match'), loaded.etag)) return null;
  c.header('ETag', loaded.etag);
  return c.json(
    {
      error: `Issue #${loaded.issue.id} was modified since it was loaded`,
      current: loaded.issue,
    },
    409,
  );
}

/**
 * Run a close/reopen precondition (`assertCanClose` / `assertCanReopen`). If
 * it throws `invalid_state` (already closed / already open), return a 409
 * with the error code and the current issue (and its ETag), writing nothing.
 * Returns null when the transition may proceed.
 */
function invalidState(
  c: Context,
  loaded: LoadedIssue,
  check: () => void,
): Response | null {
  try {
    check();
    return null;
  } catch (err) {
    if (!(err instanceof GitracError) || err.code !== 'invalid_state') {
      throw err;
    }
    c.header('ETag', loaded.etag);
    return c.json(
      { error: err.message, code: err.code, current: loaded.issue },
      409,
    );
  }
}

/**
 * Respond with the issue as now on disk (exactly what a later GET returns)
 * plus its ETag, so clients can chain `If-Match` writes. Falls back to the
 * in-memory issue if it can't be re-read.
 */
async function respondWithIssue(
  c: Context,
  dir: string,
  issue: Issue,
  status: 200 | 201 = 200,
): Promise<Response> {
  const loaded = await loadIssue(dir, issue.id);
  if (!loaded) return c.json(issue, status);
  c.header('ETag', loaded.etag);
  return c.json(loaded.issue, status);
}

/** Collect .issues/assets/ paths for all assets referenced by the issue */
function referencedAssetPaths(issue: Issue): string[] {
  const allContent = [
    issue.description,
    ...issue.comments.map((c) => c.body),
  ].join('\n');
  return extractAssetRefs(allContent).map((f) => join('.issues', 'assets', f));
}

export function issueRoutes(ctx: ServerContext): Hono {
  const app = new Hono();
  // Serialize every mutation (in-process queue + cross-process lockfile)
  const locked = mutationLock(ctx);

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
    } else if (statusFilter && isClosedStatus(statusFilter as Status)) {
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

    const loaded = await loadIssue(dir, id);
    if (!loaded) {
      return c.json({ error: `Issue #${id} not found` }, 404);
    }
    c.header('ETag', loaded.etag);
    return c.json(loaded.issue);
  });

  // POST /issues — create a new issue
  app.post('/issues', locked, async (c) => {
    const { dir, config, amendTracker } = ctx;

    // Validate everything before touching disk (allocating the ID bumps
    // nextId in config.yaml).
    const body = await readJsonBody(c);
    const fields = validateIssueFields(body, config, {
      requireTitle: true,
    });
    if (!fields.valid) {
      return validationError(c, fields.errors);
    }
    // `author` (optional) is the identity picked in the UI; default to the
    // server's git identity.
    const createdBy = await resolveAuthor(ctx, asRecord(body).author);
    if (createdBy === null) {
      return validationError(c, ['Invalid author: must be a non-empty string']);
    }
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
      createdBy,
      updated: now,
      description: values.description ?? '',
      comments: [],
    };
    // Final gate on the assembled issue (catches e.g. config defaults that
    // aren't in the configured statuses/priorities). Use a placeholder id.
    const check = validateIssue({ ...issue, id: 1 }, config);
    if (!check.valid) {
      return validationError(c, check.errors);
    }

    const id = await allocateNextId(dir);
    issue.id = id;

    const filename = await writeIssue(dir, issue);
    const extraFiles = await syncLabelColors(ctx, issue.labels);

    if (config.git.autoCommit) {
      const prefix = config.git.commitPrefix;
      const message = `${prefix} create #${id} ${issue.title}`;
      const assetPaths = referencedAssetPaths(issue);
      const hash = await commitIssueChange(
        dir,
        [
          join('.issues', filename),
          join('.issues', 'config.yaml'),
          ...extraFiles,
          ...assetPaths,
        ],
        message,
      );
      if (hash) {
        amendTracker.record(id, hash);
      }
    }

    return respondWithIssue(c, dir, issue, 201);
  });

  // PATCH /issues/:id — update issue metadata
  app.patch('/issues/:id', locked, async (c) => {
    const { dir, config, amendTracker } = ctx;
    const id = Number.parseInt(c.req.param('id'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }

    // Track original location
    const loaded = await loadIssue(dir, id);
    if (!loaded) {
      return c.json({ error: `Issue #${id} not found` }, 404);
    }
    const conflict = preconditionFailed(c, loaded);
    if (conflict) return conflict;
    const { issue, closed: wasClosed, filename: oldFilename } = loaded;

    const fields = validateIssueFields(await readJsonBody(c), config);
    if (!fields.valid) {
      return validationError(c, fields.errors);
    }
    const { title, priority, labels, assignee, status, description } =
      fields.values;

    if (title !== undefined) issue.title = title;
    if (priority !== undefined) issue.priority = priority;
    if (labels !== undefined) issue.labels = labels;
    if (assignee !== undefined) issue.assignee = assignee;
    if (status !== undefined) issue.status = status;
    if (description !== undefined) issue.description = description;
    issue.updated = new Date().toISOString();

    const nowClosed = isClosedStatus(issue.status);
    const newFilename = issueFilename(issue.id, issue.title);

    // Write to the correct directory based on current status
    const filename = await writeIssue(dir, issue, { closed: nowClosed });

    // Clean up old file if filename changed or issue moved between directories
    const filenameChanged = newFilename !== oldFilename;
    const directoryChanged = wasClosed !== nowClosed;
    if (filenameChanged || directoryChanged) {
      await deleteIssueFile(dir, oldFilename, wasClosed);
    }

    const extraFiles = await syncLabelColors(ctx, issue.labels);
    const newDir = nowClosed ? 'closed' : '';
    const newRelPath = newDir
      ? join('.issues', newDir, filename)
      : join('.issues', filename);
    const allFiles = [newRelPath, ...extraFiles];

    // Include old file path for git tracking
    if (filenameChanged || directoryChanged) {
      const oldDir = wasClosed ? 'closed' : '';
      const oldRelPath = oldDir
        ? join('.issues', oldDir, oldFilename)
        : join('.issues', oldFilename);
      allFiles.push(oldRelPath);
    }

    const assetPaths = referencedAssetPaths(issue);
    allFiles.push(...assetPaths);

    if (config.git.autoCommit) {
      const prefix = config.git.commitPrefix;
      const message = `${prefix} update #${id} ${issue.title}`;
      await amendTracker.commitOrAmend(dir, id, allFiles, message);
    }

    return respondWithIssue(c, dir, issue);
  });

  // POST /issues/:id/comments — add a comment
  app.post('/issues/:id/comments', locked, async (c) => {
    const { dir, config, amendTracker } = ctx;
    const id = Number.parseInt(c.req.param('id'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }

    const loaded = await loadIssue(dir, id);
    if (!loaded) {
      return c.json({ error: `Issue #${id} not found` }, 404);
    }
    const conflict = preconditionFailed(c, loaded);
    if (conflict) return conflict;
    const { issue, closed: isClosed } = loaded;

    const { body: commentBody, author } = asRecord(await readJsonBody(c));

    if (
      !commentBody ||
      typeof commentBody !== 'string' ||
      !commentBody.trim()
    ) {
      return c.json({ error: 'body is required' }, 400);
    }
    const commentAuthor = await resolveAuthor(ctx, author);
    if (commentAuthor === null) {
      return c.json(
        { error: 'Invalid author: must be a non-empty string' },
        400,
      );
    }

    issue.comments.push({
      author: commentAuthor,
      timestamp: new Date().toISOString(),
      body: commentBody.trim(),
    });
    issue.updated = new Date().toISOString();

    const filename = await writeIssue(dir, issue, { closed: isClosed });
    const relDir = isClosed ? join('.issues', 'closed') : '.issues';
    const relPath = join(relDir, filename);

    if (config.git.autoCommit) {
      const prefix = config.git.commitPrefix;
      const message = `${prefix} comment on #${id} ${issue.title}`;
      const assetPaths = referencedAssetPaths(issue);
      await amendTracker.commitOrAmend(
        dir,
        id,
        [relPath, ...assetPaths],
        message,
      );
    }

    return respondWithIssue(c, dir, issue);
  });

  // PUT /issues/:id/comments/:commentIndex — edit a comment
  app.put('/issues/:id/comments/:commentIndex', locked, async (c) => {
    const { dir, config, amendTracker } = ctx;
    const id = Number.parseInt(c.req.param('id'), 10);
    const commentIndex = Number.parseInt(c.req.param('commentIndex'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }
    if (Number.isNaN(commentIndex) || commentIndex < 0) {
      return c.json({ error: 'Invalid comment index' }, 400);
    }

    const loaded = await loadIssue(dir, id);
    if (!loaded) {
      return c.json({ error: `Issue #${id} not found` }, 404);
    }
    const conflict = preconditionFailed(c, loaded);
    if (conflict) return conflict;
    const { issue, closed: isClosed } = loaded;

    if (commentIndex >= issue.comments.length) {
      return c.json({ error: 'Comment index out of bounds' }, 404);
    }

    const { body: commentBody } = asRecord(await readJsonBody(c));

    if (
      !commentBody ||
      typeof commentBody !== 'string' ||
      !commentBody.trim()
    ) {
      return c.json({ error: 'body is required' }, 400);
    }

    const comment = issue.comments[commentIndex];
    if (comment) {
      comment.body = commentBody.trim();
    }
    issue.updated = new Date().toISOString();

    const filename = await writeIssue(dir, issue, { closed: isClosed });
    const relDir = isClosed ? join('.issues', 'closed') : '.issues';
    const relPath = join(relDir, filename);

    if (config.git.autoCommit) {
      const prefix = config.git.commitPrefix;
      const message = `${prefix} edit comment on #${id} ${issue.title}`;
      const assetPaths = referencedAssetPaths(issue);
      await amendTracker.commitOrAmend(
        dir,
        id,
        [relPath, ...assetPaths],
        message,
      );
    }

    return respondWithIssue(c, dir, issue);
  });

  // DELETE /issues/:id/comments/:commentIndex — delete a comment
  app.delete('/issues/:id/comments/:commentIndex', locked, async (c) => {
    const { dir, config, amendTracker } = ctx;
    const id = Number.parseInt(c.req.param('id'), 10);
    const commentIndex = Number.parseInt(c.req.param('commentIndex'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }
    if (Number.isNaN(commentIndex) || commentIndex < 0) {
      return c.json({ error: 'Invalid comment index' }, 400);
    }

    const loaded = await loadIssue(dir, id);
    if (!loaded) {
      return c.json({ error: `Issue #${id} not found` }, 404);
    }
    const conflict = preconditionFailed(c, loaded);
    if (conflict) return conflict;
    const { issue, closed: isClosed } = loaded;

    if (commentIndex >= issue.comments.length) {
      return c.json({ error: 'Comment index out of bounds' }, 404);
    }

    issue.comments.splice(commentIndex, 1);
    issue.updated = new Date().toISOString();

    const filename = await writeIssue(dir, issue, { closed: isClosed });
    const relDir = isClosed ? join('.issues', 'closed') : '.issues';
    const relPath = join(relDir, filename);

    if (config.git.autoCommit) {
      const prefix = config.git.commitPrefix;
      const message = `${prefix} delete comment on #${id} ${issue.title}`;
      await amendTracker.commitOrAmend(dir, id, [relPath], message);
    }

    return respondWithIssue(c, dir, issue);
  });

  // PATCH /issues/:id/close — close an issue
  app.patch('/issues/:id/close', locked, async (c) => {
    const { dir, config, amendTracker } = ctx;
    const id = Number.parseInt(c.req.param('id'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }

    const loaded = await loadIssue(dir, id);
    if (!loaded) {
      return c.json({ error: `Issue #${id} not found` }, 404);
    }
    const conflict = preconditionFailed(c, loaded);
    if (conflict) return conflict;
    const invalid = invalidState(c, loaded, () =>
      assertCanClose(loaded.issue, loaded.closed),
    );
    if (invalid) return invalid;
    const { issue } = loaded;

    issue.status = 'done';
    issue.updated = new Date().toISOString();

    // Write into .issues/closed/ and remove the open copy
    const paths = await relocateIssue(dir, issue, loaded, { closed: true });

    if (config.git.autoCommit) {
      const prefix = config.git.commitPrefix;
      const message = `${prefix} close #${id} ${issue.title}`;
      const assetPaths = referencedAssetPaths(issue);
      await amendTracker.commitOrAmend(
        dir,
        id,
        [...paths, ...assetPaths],
        message,
      );
    }

    return respondWithIssue(c, dir, issue);
  });

  // PATCH /issues/:id/reopen — reopen a closed issue. Optional JSON body
  // `{ status }` picks the status (default: config.defaultStatus).
  app.patch('/issues/:id/reopen', locked, async (c) => {
    const { dir, config, amendTracker } = ctx;
    const id = Number.parseInt(c.req.param('id'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }

    const loaded = await loadIssue(dir, id);
    if (!loaded) {
      return c.json({ error: `Issue #${id} not found` }, 404);
    }
    const conflict = preconditionFailed(c, loaded);
    if (conflict) return conflict;
    const invalid = invalidState(c, loaded, () =>
      assertCanReopen(loaded.issue, loaded.closed),
    );
    if (invalid) return invalid;
    const { issue } = loaded;

    const currentConfig = await readConfig(dir);
    const { status: requested } = asRecord(await readJsonBody(c));
    let status: Status;
    try {
      status = reopenStatus(currentConfig, requested ?? undefined);
    } catch (err) {
      if (err instanceof GitracError) {
        return validationError(c, [err.message]);
      }
      throw err;
    }
    issue.status = status;
    issue.updated = new Date().toISOString();

    // Write into .issues/ and remove the closed copy
    const paths = await relocateIssue(dir, issue, loaded, { closed: false });

    if (config.git.autoCommit) {
      const prefix = config.git.commitPrefix;
      const message = `${prefix} reopen #${id} ${issue.title}`;
      const assetPaths = referencedAssetPaths(issue);
      await amendTracker.commitOrAmend(
        dir,
        id,
        [...paths, ...assetPaths],
        message,
      );
    }

    return respondWithIssue(c, dir, issue);
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
