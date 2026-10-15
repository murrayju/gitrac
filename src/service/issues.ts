import { GitracError, invalidInput } from '../core/errors.ts';
import {
  assertCanClose,
  assertCanReopen,
  reopenStatus,
} from '../core/lifecycle.ts';
import type { Config, Issue, Status } from '../core/types.ts';
import { isClosedStatus } from '../core/types.ts';
import { validateIssue, validateIssueFields } from '../core/validate.ts';
import {
  registerLabels,
  relocateIssue,
  writeIssue,
} from '../fs/issue-store.ts';
import { allocateIssueId } from '../git/ids.ts';
import { withRepoLock } from '../git/lock.ts';
import {
  assetPaths,
  CONFIG_PATH,
  commitChange,
  commitMessage,
  INVALID_AUTHOR,
  issuePath,
  loadConfig,
  type Operation,
  resolveAuthor,
  type ServiceContext,
} from './context.ts';
import { ValidationError } from './errors.ts';
import { loadStoredIssue, type Precondition } from './load.ts';

/**
 * Issue mutations shared by the CLI and the web API. Every operation runs its
 * whole read-validate-write-commit sequence under the repo lock
 * (`withRepoLock`, re-entrant), reads the config fresh inside it, and
 * validates input before loading the issue (so input errors take precedence
 * over not-found / state errors) and before touching disk. CLI and web get
 * identical behavior: commit messages, committed files (incl. referenced
 * assets), trimmed comments. Errors are `GitracError`s: the CLI
 * maps them to exit codes, the web API to HTTP statuses.
 */

/** The result of an issue mutation. */
export interface IssueChange {
  /** The issue as written. */
  issue: Issue;
  /** Repo-relative paths written / removed (what was, or would be, committed). */
  paths: string[];
  /** The config after the change (e.g. with newly registered labels). */
  config: Config;
  /** The new commit's hash, or null if nothing was committed (or it was amended). */
  commit: string | null;
}

/** Options for operations on an existing issue. */
export interface ExistingIssueOptions {
  /**
   * Checked on the loaded issue before it is changed (e.g. `If-Match`). Input
   * is validated first, so a bad request is `invalid_input` even if stale.
   */
  precondition?: Precondition;
}

/** Throw a {@link ValidationError} for the fields, or return the values. */
function validFields(
  input: unknown,
  config: Config,
  options: { requireTitle?: boolean } = {},
) {
  const fields = validateIssueFields(input, config, options);
  if (!fields.valid) throw new ValidationError(fields.errors);
  return fields.values;
}

/**
 * Append a comment by the context's identity (CLI `-c/--comment`). The body
 * is trimmed, like every comment; a blank one adds nothing.
 */
async function appendComment(
  ctx: ServiceContext,
  issue: Issue,
  body: string | undefined,
  timestamp: string,
): Promise<void> {
  const text = body?.trim();
  if (!text) return;
  issue.comments.push({
    author: (await ctx.identity()).name,
    timestamp,
    body: text,
  });
}

/** Commit an issue change and assemble the result. */
async function finish(
  ctx: ServiceContext,
  config: Config,
  change: {
    operation: Operation;
    issue: Issue;
    paths: string[];
    message: string;
    config?: Config;
  },
): Promise<IssueChange> {
  const commit = await commitChange(ctx, config, change);
  return {
    issue: change.issue,
    paths: change.paths,
    config: change.config ?? config,
    commit,
  };
}

/**
 * Create an issue from untrusted `fields` (title required). `author`
 * overrides the context's identity as `createdBy`. Unknown labels are
 * registered in config.yaml.
 */
export async function createIssue(
  ctx: ServiceContext,
  fields: unknown,
  options: { author?: unknown } = {},
): Promise<IssueChange> {
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    // Validate everything before touching disk (allocating the ID bumps the
    // shared high-water mark).
    const values = validFields(fields, config, { requireTitle: true });
    const createdBy = await resolveAuthor(ctx, options.author);
    if (createdBy === null) throw new ValidationError([INVALID_AUTHOR]);

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
    // Final gate on the assembled issue (e.g. config defaults that aren't in
    // the configured statuses/priorities). Use a placeholder id.
    const check = validateIssue({ ...issue, id: 1 }, config);
    if (!check.valid) throw new ValidationError(check.errors);

    const id = await allocateIssueId(ctx.dir);
    issue.id = id;

    const filename = await writeIssue(ctx.dir, issue);
    // Unknown labels get a color in config.yaml.
    const updated = await registerLabels(ctx.dir, issue.labels);

    return finish(ctx, config, {
      operation: 'create',
      issue,
      // config.yaml only changes (and is committed) when new labels were
      // registered; the ID counter no longer lives there.
      paths: [
        issuePath(filename, false),
        ...(updated ? [CONFIG_PATH] : []),
        ...assetPaths(issue),
      ],
      message: commitMessage(config, `create #${id} ${issue.title}`),
      config: updated ?? undefined,
    });
  });
}

/**
 * Update an issue's fields (title, status, priority, assignee, labels,
 * description) from untrusted `fields`; absent fields are left alone. Moves
 * the file between `.issues/` and `.issues/closed/` (or renames it) as the
 * status/title require. `comment` adds a comment by the context's identity.
 */
export async function updateIssue(
  ctx: ServiceContext,
  id: number,
  fields: unknown,
  options: ExistingIssueOptions & { comment?: string } = {},
): Promise<IssueChange> {
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    // Input errors take precedence over issue errors (missing, If-Match...).
    const { title, status, priority, assignee, labels, description } =
      validFields(fields, config);
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const { issue } = stored;

    if (title !== undefined) issue.title = title;
    if (status !== undefined) issue.status = status;
    if (priority !== undefined) issue.priority = priority;
    if (assignee !== undefined) issue.assignee = assignee;
    if (labels !== undefined) issue.labels = labels;
    if (description !== undefined) issue.description = description;
    const now = new Date().toISOString();
    issue.updated = now;
    await appendComment(ctx, issue, options.comment, now);

    // Write to the directory matching the status; drop the old file if the
    // path changed (moved between directories or renamed).
    const [newPath, ...oldPaths] = await relocateIssue(ctx.dir, issue, stored, {
      closed: isClosedStatus(issue.status),
    });
    // config.yaml only changes (and is committed) when new labels were
    // registered.
    const updated = await registerLabels(ctx.dir, issue.labels);

    return finish(ctx, config, {
      operation: 'update',
      issue,
      paths: [
        newPath as string,
        ...(updated ? [CONFIG_PATH] : []),
        ...oldPaths,
        ...assetPaths(issue),
      ],
      message: commitMessage(config, `edit #${id} ${issue.title}`),
      config: updated ?? undefined,
    });
  });
}

/** Throw unless `body` is a non-empty string; returns it trimmed. */
function commentBody(body: unknown): string {
  if (typeof body !== 'string' || !body.trim()) {
    throw invalidInput('body is required');
  }
  return body.trim();
}

/** Throw unless `index` addresses an existing comment of `issue`. */
function assertCommentIndex(issue: Issue, index: number): void {
  if (index >= issue.comments.length) {
    throw new GitracError('not_found', 'Comment index out of bounds', {
      details: { id: issue.id, index },
    });
  }
}

/** Throw `invalid_input` unless `index` is a non-negative integer. */
function validCommentIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0) {
    throw invalidInput('Invalid comment index');
  }
}

/**
 * Rewrite an issue in its current directory after a comment change. Like
 * close/reopen/update, a file whose name no longer matches the title is
 * replaced (renamed), so the issue stays one file. Returns the paths to
 * commit.
 */
function writeInPlace(
  ctx: ServiceContext,
  stored: { issue: Issue; filename: string; closed: boolean },
): Promise<string[]> {
  return relocateIssue(ctx.dir, stored.issue, stored, {
    closed: stored.closed,
  });
}

/**
 * Add a comment. `body` must be a non-empty string (trimmed); `author`
 * overrides the context's identity.
 */
export async function addComment(
  ctx: ServiceContext,
  id: number,
  body: unknown,
  options: ExistingIssueOptions & { author?: unknown } = {},
): Promise<IssueChange> {
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const text = commentBody(body);
    const author = await resolveAuthor(ctx, options.author);
    if (author === null) throw invalidInput(INVALID_AUTHOR);
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const { issue } = stored;

    const now = new Date().toISOString();
    issue.comments.push({ author, timestamp: now, body: text });
    issue.updated = now;

    const issuePaths = await writeInPlace(ctx, stored);
    return finish(ctx, config, {
      operation: 'comment',
      issue,
      paths: [...issuePaths, ...assetPaths(issue)],
      message: commitMessage(config, `comment on #${id} ${issue.title}`),
    });
  });
}

/** Replace the body of the comment at `index` (0-based). */
export async function editComment(
  ctx: ServiceContext,
  id: number,
  index: number,
  body: unknown,
  options: ExistingIssueOptions = {},
): Promise<IssueChange> {
  validCommentIndex(index);
  const text = commentBody(body);
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const { issue } = stored;
    assertCommentIndex(issue, index);

    const comment = issue.comments[index];
    if (comment) comment.body = text;
    issue.updated = new Date().toISOString();

    const issuePaths = await writeInPlace(ctx, stored);
    return finish(ctx, config, {
      operation: 'edit-comment',
      issue,
      paths: [...issuePaths, ...assetPaths(issue)],
      message: commitMessage(config, `edit comment on #${id} ${issue.title}`),
    });
  });
}

/** Delete the comment at `index` (0-based). */
export async function deleteComment(
  ctx: ServiceContext,
  id: number,
  index: number,
  options: ExistingIssueOptions = {},
): Promise<IssueChange> {
  validCommentIndex(index);
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const { issue } = stored;
    assertCommentIndex(issue, index);

    issue.comments.splice(index, 1);
    issue.updated = new Date().toISOString();

    const issuePaths = await writeInPlace(ctx, stored);
    return finish(ctx, config, {
      operation: 'delete-comment',
      issue,
      // Assets the issue still references are committed; ones referenced
      // only by the deleted comment are left alone (never removed: another
      // issue may share them).
      paths: [...issuePaths, ...assetPaths(issue)],
      message: commitMessage(config, `delete comment on #${id} ${issue.title}`),
    });
  });
}

/**
 * Close an issue: status `done` (or `cancelled`), file moved into
 * `.issues/closed/`. Closing a closed issue is `invalid_state` and writes
 * nothing (see `src/core/lifecycle.ts`).
 */
export async function closeIssue(
  ctx: ServiceContext,
  id: number,
  options: ExistingIssueOptions & {
    cancelled?: boolean;
    comment?: string;
  } = {},
): Promise<IssueChange> {
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const { issue } = stored;
    assertCanClose(issue, stored.closed);

    issue.status = options.cancelled ? 'cancelled' : 'done';
    const now = new Date().toISOString();
    issue.updated = now;
    await appendComment(ctx, issue, options.comment, now);

    // Write into .issues/closed/ and remove the open copy
    const paths = await relocateIssue(ctx.dir, issue, stored, {
      closed: true,
    });
    return finish(ctx, config, {
      operation: 'close',
      issue,
      paths: [...paths, ...assetPaths(issue)],
      message: commitMessage(config, `close #${id} ${issue.title}`),
    });
  });
}

/** `reopenStatus`, reporting a bad status as a {@link ValidationError}. */
function validReopenStatus(config: Config, requested: unknown): Status {
  try {
    return reopenStatus(config, requested);
  } catch (err) {
    if (err instanceof GitracError) throw new ValidationError([err.message]);
    throw err;
  }
}

/**
 * Reopen a closed issue with `status` (default: `config.defaultStatus`),
 * moving its file back into `.issues/`. Reopening an open issue is
 * `invalid_state` and writes nothing (see `src/core/lifecycle.ts`).
 */
export async function reopenIssue(
  ctx: ServiceContext,
  id: number,
  options: ExistingIssueOptions & { status?: unknown; comment?: string } = {},
): Promise<IssueChange> {
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    // Input errors take precedence over issue errors (missing, open...).
    const status = validReopenStatus(config, options.status);
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const { issue } = stored;
    assertCanReopen(issue, stored.closed);

    issue.status = status;
    const now = new Date().toISOString();
    issue.updated = now;
    await appendComment(ctx, issue, options.comment, now);

    // Write into .issues/ and remove the closed copy
    const paths = await relocateIssue(ctx.dir, issue, stored, {
      closed: false,
    });
    return finish(ctx, config, {
      operation: 'reopen',
      issue,
      paths: [...paths, ...assetPaths(issue)],
      message: commitMessage(config, `reopen #${id} ${issue.title}`),
    });
  });
}
