import type { Command } from 'commander';
import type { Config, OutputFormat } from '../core/types.ts';
import { LockTimeoutError } from '../fs/lock.ts';
import { withRepoLock } from '../git/lock.ts';
import { commitIssueChange, pushIfConfigured } from '../git/operations.ts';

/**
 * Normalized view of the program-level (global) CLI options.
 *
 * Commander stores negated flags under their positive name: `--no-commit`
 * sets `commit: false`, and `--push` / `--no-push` set `push: true` / `false`
 * (left `undefined` when neither is given). Always read global options through
 * {@link getGlobalOptions} rather than `program.opts()` directly.
 */
export interface GlobalOptions {
  /** Project root (from `--dir`, default: cwd). */
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
}

interface RawGlobalOptions {
  dir?: string;
  output?: string;
  author?: string;
  commit?: boolean;
  push?: boolean;
  port?: string;
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
  };
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
 * If the lock can't be acquired in time, prints an error and exits 1.
 */
export async function withMutationLock<T>(
  opts: GlobalOptions,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await withRepoLock(opts.dir, fn);
  } catch (err) {
    if (err instanceof LockTimeoutError) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
