import { join } from 'node:path';
import { extractAssetRefs, isAssetFilename } from '../core/assets.ts';
import type { ClaimUser } from '../core/claim.ts';
import { type GitracError, invalidInput } from '../core/errors.ts';
import type { Config, Issue } from '../core/types.ts';
import { authorError } from '../core/validate.ts';
import { readConfig } from '../fs/issue-store.ts';
import { pushIfConfigured } from '../git/operations.ts';
import { type CommitStrategy, commitStrategy } from './commit.ts';

/** A mutation performed by the service layer (names the commit kind). */
export type Operation =
  | 'init'
  | 'create'
  | 'update'
  | 'comment'
  | 'edit-comment'
  | 'delete-comment'
  | 'close'
  | 'reopen'
  | 'delete'
  | 'renumber'
  | 'claim'
  | 'unclaim'
  | 'review'
  | 'link'
  | 'unlink'
  | 'label-colors'
  | 'assignees'
  | 'merge-driver';

/** What a mutation wrote, passed to {@link ServiceContext.onWritten}. */
export interface WrittenChange {
  operation: Operation;
  /** The issue as written, or null for config-only changes. */
  issue: Issue | null;
  /** Repo-relative paths that will be committed. */
  paths: string[];
}

/**
 * Everything a service operation needs from its caller. The CLI builds one
 * from the global options (`src/cli/service-context.ts`), the web server from
 * its `ServerContext` (`src/web/service-context.ts`).
 */
export interface ServiceContext {
  /** Project root (the git top level containing `.issues/`). */
  dir: string;
  /**
   * The acting user (default author / claimer). Called lazily, only when an
   * operation needs it.
   */
  identity: () => Promise<ClaimUser>;
  /**
   * Load the config. Called once per operation, while holding the repo lock,
   * so it must return what is on disk now. Default: `readConfig(dir)`.
   */
  loadConfig?: () => Promise<Config>;
  /** Write files but don't commit (`--no-commit`). */
  noCommit?: boolean;
  /**
   * Push after committing: true / false, or undefined to follow
   * `config.git.autoPush`. Nothing is pushed when nothing is committed.
   */
  push?: boolean;
  /** How to commit (default: {@link commitStrategy}). */
  commit?: CommitStrategy;
  /**
   * Called instead of throwing when the push after a commit fails (the change
   * is already written and committed). Unset: the push error is thrown.
   */
  onPushError?: (err: unknown) => void;
  /**
   * Called after the files are written, before committing/pushing, so a
   * caller can report the result even if the commit then fails.
   */
  onWritten?: (change: WrittenChange) => void;
}

/** Repo-relative path of config.yaml. */
export const CONFIG_PATH = join('.issues', 'config.yaml');

/** Repo-relative path of an issue file in `.issues/` or `.issues/closed/`. */
export function issuePath(filename: string, closed: boolean): string {
  return closed
    ? join('.issues', 'closed', filename)
    : join('.issues', filename);
}

/** A commit message: `<commitPrefix> <text>` (e.g. `issue: close #5 Title`). */
export function commitMessage(config: Config, text: string): string {
  return `${config.git.commitPrefix} ${text}`;
}

/** The config, as seen while holding the lock. */
export function loadConfig(ctx: ServiceContext): Promise<Config> {
  return ctx.loadConfig ? ctx.loadConfig() : readConfig(ctx.dir);
}

/**
 * `.issues/assets/` paths referenced by the issue's description and comments,
 * committed along with it so the issue never points at an uncommitted image.
 * Only plain filenames count (a ref with `/` or `..` never adds a path
 * outside `.issues/assets/`); refs to files that don't exist are skipped by
 * the commit.
 */
export function assetPaths(issue: Issue): string[] {
  const allContent = [
    issue.description,
    ...issue.comments.map((c) => c.body),
  ].join('\n');
  return extractAssetRefs(allContent)
    .filter(isAssetFilename)
    .map((f) => join('.issues', 'assets', f));
}

/**
 * The author for a write: an explicit `requested` name (e.g. the identity
 * picked in the web UI) wins, else the context's identity. An explicit name
 * is trimmed. Throws the error from `fail` (default: `invalid_input`) if the
 * name is not a valid author (see `authorError`).
 */
export async function resolveAuthor(
  ctx: ServiceContext,
  requested: unknown,
  fail: (message: string) => GitracError = invalidInput,
): Promise<string> {
  if (requested === undefined) return identityName(ctx, fail);
  const name = typeof requested === 'string' ? requested.trim() : requested;
  const error = authorError(name);
  if (error) throw fail(error);
  return name as string;
}

/**
 * The context's identity name, for an author it writes (a comment, or a
 * claim). Throws the error from `fail` (default: `invalid_input`) if the
 * name is not a valid author (for example, a git `user.name` with a line
 * break).
 */
export async function identityName(
  ctx: ServiceContext,
  fail: (message: string) => GitracError = invalidInput,
): Promise<string> {
  const { name } = await ctx.identity();
  const error = authorError(name);
  if (error) throw fail(error);
  return name;
}

/**
 * Report the written change, then commit it (unless `noCommit` or
 * `git.autoCommit: false`) with the context's strategy and push per
 * `ctx.push` / `config.git.autoPush`. Returns the commit hash, if known.
 * Callers hold the repo lock.
 */
export async function commitChange(
  ctx: ServiceContext,
  config: Config,
  change: WrittenChange & { message: string },
): Promise<string | null> {
  ctx.onWritten?.({
    operation: change.operation,
    issue: change.issue,
    paths: change.paths,
  });
  if (ctx.noCommit || !config.git.autoCommit) return null;
  const strategy = ctx.commit ?? commitStrategy;
  const hash = await strategy({
    dir: ctx.dir,
    operation: change.operation,
    issueId: change.issue?.id ?? null,
    files: change.paths,
    message: change.message,
  });
  try {
    await pushIfConfigured(ctx.dir, config, { push: ctx.push });
  } catch (err) {
    if (!ctx.onPushError) throw err;
    ctx.onPushError(err);
  }
  return hash;
}
