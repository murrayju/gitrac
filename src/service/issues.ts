import { sameDescription } from '../core/description.ts';
import { GitracError, invalidInput } from '../core/errors.ts';
import {
  assertCanClose,
  assertCanReopen,
  closingStatus,
  reopenStatus,
} from '../core/lifecycle.ts';
import type { Config, Issue, Status } from '../core/types.ts';
import { validateIssue, validateIssueFields } from '../core/validate.ts';
import { isClosedStatus } from '../core/workflow.ts';
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
  identityName,
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
 * The author of an optional comment (CLI `-c/--comment`): the context's
 * identity, or undefined if the comment is blank. Call it before the issue is
 * loaded, so an invalid identity is `invalid_input` first.
 */
async function commentAuthor(
  ctx: ServiceContext,
  body: string | undefined,
): Promise<string | undefined> {
  return body?.trim() ? identityName(ctx) : undefined;
}

/**
 * Append a comment by `author` (from {@link commentAuthor}). The body is
 * trimmed, like every comment; a blank one adds nothing.
 */
function appendComment(
  issue: Issue,
  author: string | undefined,
  body: string | undefined,
  timestamp: string,
): void {
  const text = body?.trim();
  if (!text || author === undefined) return;
  issue.comments.push({ author, timestamp, body: text });
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
 * registered in config.yaml. An issue with a closed status is written to
 * `.issues/closed/`.
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
    const createdBy = await resolveAuthor(
      ctx,
      options.author,
      (message) => new ValidationError([message]),
    );

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

    // An issue created with a closed status goes straight into
    // .issues/closed/, like one closed later.
    const closed = isClosedStatus(config, issue.status);
    const filename = await writeIssue(ctx.dir, issue, { closed });
    // Unknown labels get a color in config.yaml.
    const updated = await registerLabels(ctx.dir, issue.labels);

    return finish(ctx, config, {
      operation: 'create',
      issue,
      // config.yaml only changes (and is committed) when new labels were
      // registered; the ID counter no longer lives there.
      paths: [
        issuePath(filename, closed),
        ...(updated ? [CONFIG_PATH] : []),
        ...assetPaths(issue),
      ],
      message: commitMessage(config, `create #${id} ${issue.title}`),
      config: updated ?? undefined,
    });
  });
}

/**
 * The result of {@link updateIssue}. `changed: false` when every given field
 * already had that value (and no comment was added): nothing was written or
 * committed (`paths: []`, `updated` not bumped) and `issue` is the issue as
 * stored.
 */
export type UpdateResult = IssueChange & { changed: boolean };

const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * Update an issue's fields (title, status, priority, assignee, labels,
 * description) from untrusted `fields`; absent fields are left alone. Moves
 * the file between `.issues/` and `.issues/closed/` (or renames it) as the
 * status/title require. `comment` adds a comment by the context's identity.
 *
 * A no-op — every given field equal to the stored one (a description after
 * {@link sameDescription}: only leading/trailing whitespace differs), and no
 * (non-blank) comment — writes nothing, doesn't bump `updated`, doesn't
 * commit, and returns `changed: false`. The precondition still applies.
 */
export async function updateIssue(
  ctx: ServiceContext,
  id: number,
  fields: unknown,
  options: ExistingIssueOptions & { comment?: string } = {},
): Promise<UpdateResult> {
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    // Input errors take precedence over issue errors (missing, If-Match...).
    const { title, status, priority, assignee, labels, description } =
      validFields(fields, config);
    const author = await commentAuthor(ctx, options.comment);
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const { issue } = stored;

    let changed = false;
    if (title !== undefined && title !== issue.title) {
      issue.title = title;
      changed = true;
    }
    if (status !== undefined && status !== issue.status) {
      issue.status = status;
      changed = true;
    }
    if (priority !== undefined && priority !== issue.priority) {
      issue.priority = priority;
      changed = true;
    }
    if (assignee !== undefined && assignee !== issue.assignee) {
      issue.assignee = assignee;
      changed = true;
    }
    if (labels !== undefined && !sameList(labels, issue.labels)) {
      issue.labels = labels;
      changed = true;
    }
    // Keep the stored text when only surrounding whitespace differs (e.g.
    // the empty paragraph the web editor appends after a final code block).
    if (
      description !== undefined &&
      !sameDescription(description, issue.description)
    ) {
      issue.description = description;
      changed = true;
    }
    if (!changed && !options.comment?.trim()) {
      return { changed: false, issue, paths: [], config, commit: null };
    }
    const now = new Date().toISOString();
    issue.updated = now;
    appendComment(issue, author, options.comment, now);

    // Write to the directory matching the status; drop the old file if the
    // path changed (moved between directories or renamed).
    const [newPath, ...oldPaths] = await relocateIssue(ctx.dir, issue, stored, {
      closed: isClosedStatus(config, issue.status),
    });
    // config.yaml only changes (and is committed) when new labels were
    // registered.
    const updated = await registerLabels(ctx.dir, issue.labels);

    const result = await finish(ctx, config, {
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
    return { ...result, changed: true };
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
 * Close an issue: status `options.status` (a configured closed status), or
 * the configured close status (`closeStatus`, default `done`) — the cancel
 * status (`cancelStatus`, default `cancelled`) with `cancelled` — and the
 * file moved into `.issues/closed/`. A bad status, or `cancelled` with no
 * cancel status configured, is `invalid_input`; closing a closed issue is
 * `invalid_state`; neither writes anything (see `src/core/lifecycle.ts`).
 */
export async function closeIssue(
  ctx: ServiceContext,
  id: number,
  options: ExistingIssueOptions & {
    cancelled?: boolean;
    status?: unknown;
    comment?: string;
  } = {},
): Promise<IssueChange> {
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    // Input errors take precedence over issue errors (missing, closed...).
    const status = validStatus(() => closingStatus(config, options));
    const author = await commentAuthor(ctx, options.comment);
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const { issue } = stored;
    assertCanClose(issue, stored.closed, config);

    issue.status = status;
    const now = new Date().toISOString();
    issue.updated = now;
    appendComment(issue, author, options.comment, now);

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

/** Pick a status, reporting a bad one as a {@link ValidationError}. */
function validStatus(pick: () => Status): Status {
  try {
    return pick();
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
    const status = validStatus(() => reopenStatus(config, options.status));
    const author = await commentAuthor(ctx, options.comment);
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const { issue } = stored;
    assertCanReopen(issue, stored.closed, config);

    issue.status = status;
    const now = new Date().toISOString();
    issue.updated = now;
    appendComment(issue, author, options.comment, now);

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
