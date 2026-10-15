import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { GitracError } from '../core/errors.ts';
import type { Config, OutputFormat } from '../core/types.ts';
import { withRepoLock } from '../git/lock.ts';
import { commitIssueChange, pushIfConfigured } from '../git/operations.ts';
import { getGitRoot } from '../git/status.ts';
import { DEFAULT_HOST } from '../web/security.ts';

/**
 * Normalized view of the program-level (global) CLI options.
 *
 * Commander stores negated flags under their positive name: `--no-commit`
 * sets `commit: false`, and `--push` / `--no-push` set `push: true` / `false`
 * (left `undefined` when neither is given). Always read global options through
 * {@link getGlobalOptions} rather than `program.opts()` directly.
 */
export interface GlobalOptions {
  /**
   * Directory to start from (from `--dir`, default: cwd). This is NOT
   * necessarily the project root; use {@link resolveProjectOptions} to get
   * options whose `dir` is the resolved git root.
   */
  dir: string;
  /** Output format (from `-o, --output`). */
  output: OutputFormat;
  /** Explicit author name (from `--author`), or '' if not given. */
  author: string;
  /** False when `--no-commit` was passed. */
  commit: boolean;
  /**
   * Push override: true for `--push`, false for `--no-push`, undefined to
   * defer to `config.git.autoPush`. The last flag on the command line wins.
   */
  push: boolean | undefined;
  /** Web server port (from the long-only `--port`; default 3000). See `serve -p`. */
  port: number;
  /** Web server bind interface (from the long-only `--host`; default 127.0.0.1). */
  host: string;
}

interface RawGlobalOptions {
  dir?: string;
  output?: string;
  author?: string;
  commit?: boolean;
  push?: boolean;
  port?: string;
  host?: string;
}

export function getGlobalOptions(program: Command): GlobalOptions {
  const raw = program.opts<RawGlobalOptions>();
  return {
    dir: raw.dir || process.cwd(),
    output: (raw.output || 'human') as OutputFormat,
    author: raw.author || '',
    commit: raw.commit !== false,
    push: typeof raw.push === 'boolean' ? raw.push : undefined,
    port: Number.parseInt(raw.port ?? '3000', 10),
    host: raw.host || DEFAULT_HOST,
  };
}

/**
 * Thrown by {@link resolveProjectRoot} with a user-facing message. Its code is
 * `not_a_git_repo` or `not_initialized` (exit code `EXIT_NOT_A_PROJECT`).
 */
export class ProjectRootError extends GitracError {
  constructor(
    message: string,
    readonly reason: 'not-a-git-repo' | 'not-initialized',
  ) {
    super(
      reason === 'not-a-git-repo' ? 'not_a_git_repo' : 'not_initialized',
      message,
    );
    this.name = 'ProjectRootError';
  }
}

/**
 * Resolve the gitrac project root: the top level of the git work tree that
 * contains `dir` (`git rev-parse --show-toplevel`). This lets every command
 * (and the web server) run from any subdirectory of the repo, or with
 * `--dir` pointing anywhere inside it.
 *
 * With `requireInit` (the default), also verifies that `.issues/config.yaml`
 * exists at the root. Throws {@link ProjectRootError} on failure.
 */
export async function resolveProjectRoot(
  dir: string,
  options: { requireInit?: boolean } = {},
): Promise<string> {
  const start = resolve(dir);
  if (!existsSync(start)) {
    throw new ProjectRootError(
      `Directory does not exist: ${start}`,
      'not-a-git-repo',
    );
  }
  let root: string;
  try {
    root = resolve(await getGitRoot(start));
  } catch {
    throw new ProjectRootError(
      `Not inside a git repository: ${start}`,
      'not-a-git-repo',
    );
  }
  if (!root) {
    // e.g. inside a .git directory or a bare repository
    throw new ProjectRootError(
      `Not inside a git work tree: ${start}`,
      'not-a-git-repo',
    );
  }
  if (
    options.requireInit !== false &&
    !existsSync(join(root, '.issues', 'config.yaml'))
  ) {
    throw new ProjectRootError(
      `gitrac is not initialized in ${root} (no .issues/config.yaml). Run "gitrac init" to set it up.`,
      'not-initialized',
    );
  }
  return root;
}

/**
 * Like {@link getGlobalOptions}, but with `dir` replaced by the resolved
 * project root (see {@link resolveProjectRoot}). Every command should use
 * this. On failure, throws a {@link ProjectRootError}, which the top-level
 * handler prints as a friendly error.
 */
export async function resolveProjectOptions(
  program: Command,
  options: { requireInit?: boolean } = {},
): Promise<GlobalOptions> {
  const opts = getGlobalOptions(program);
  return { ...opts, dir: await resolveProjectRoot(opts.dir, options) };
}

/** Whether a mutating command should auto-commit its changes. */
export function shouldCommit(opts: GlobalOptions, config: Config): boolean {
  return opts.commit && config.git.autoCommit;
}

/**
 * Commit the given files (if auto-commit is enabled and `--no-commit` was not
 * passed), then push according to `--push` / `--no-push` / `autoPush`.
 * Returns the commit hash, or null if nothing was committed.
 */
export async function commitAndMaybePush(
  opts: GlobalOptions,
  config: Config,
  files: string[],
  message: string,
): Promise<string | null> {
  if (!shouldCommit(opts, config)) {
    return null;
  }
  const hash = await commitIssueChange(opts.dir, files, message);
  await pushIfConfigured(opts.dir, config, { push: opts.push });
  return hash;
}

/**
 * Run a mutating command's whole read-modify-write-commit sequence (including
 * ID allocation and `--no-commit` file writes) while holding the repo-wide
 * gitrac lock, so concurrent gitrac processes and the web server can't
 * interleave. Keep interactive input (prompts, stdin) outside of `fn`.
 *
 * The lock is released when `fn` settles, so commands signal failure by
 * throwing (a `GitracError`) rather than calling `process.exit`. If the lock
 * can't be acquired in time, throws a `LockTimeoutError` (`lock_timeout`).
 */
export async function withMutationLock<T>(
  opts: GlobalOptions,
  fn: () => Promise<T>,
): Promise<T> {
  return withRepoLock(opts.dir, fn);
}
