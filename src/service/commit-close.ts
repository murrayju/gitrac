import { join } from 'node:path';
import { GitracError } from '../core/errors.ts';
import { analyzeCommitArgs } from '../core/git-commit-args.ts';
import type { Issue } from '../core/types.ts';
import { findIssueFiles } from '../fs/issue-store.ts';
import { withRepoLock } from '../git/lock.ts';
import {
  headCommit,
  pushIfConfigured,
  runGitCommit,
  stagedFiles,
  stageFiles,
} from '../git/operations.ts';
import {
  type PathSnapshot,
  restorePaths,
  snapshotPaths,
} from '../git/path-snapshot.ts';
import { loadConfig, type ServiceContext } from './context.ts';
import { closeIssue } from './issues.ts';

const ASSETS_DIR = join('.issues', 'assets', '');

/** The result of {@link closeWithCommit}. */
export interface CommitClose {
  /** The closed issue. */
  issue: Issue;
  /** Repo-relative issue paths that went into the commit. */
  paths: string[];
  /** The hash of the new commit. */
  commit: string;
}

/**
 * Close an issue and run `git commit <gitArgs>`, so the close goes into the
 * same commit as the staged code changes. gitrac adds no commit message:
 * git's usual message flow applies (`-m`, `-F`, the editor).
 *
 * 1. Reject `gitArgs` with pathspecs (git would commit only those paths and
 *    leave the issue out), and reject when nothing is staged besides the
 *    issue (unless `-a` or `--amend`). Both are `invalid_input`, with
 *    `details.reason` `pathspec` / `nothing_staged`.
 * 2. Close the issue with {@link closeIssue} (not committed) and stage its
 *    paths, under the repo lock.
 * 3. Run `git commit` outside the lock, with the terminal attached.
 * 4. If git fails or makes no commit (HEAD did not move, for example with
 *    `--dry-run`), put the issue files and their index entries back as they
 *    were and throw `git_error` (`details.exitCode`). Otherwise call
 *    `onCommitted` and push per `ctx.push` / `config.git.autoPush`.
 *
 * `ctx.noCommit` and `ctx.commit` are ignored: this always commits, with git.
 */
export async function closeWithCommit(
  ctx: ServiceContext,
  id: number,
  options: {
    cancelled?: boolean;
    status?: unknown;
    comment?: string;
    force?: boolean;
    /** Arguments for `git commit`. */
    gitArgs?: readonly string[];
    /** Where git's stdout goes (default: this process's stdout). */
    gitStdout?: 'stdout' | 'stderr';
    /** Called after the commit, before the push. */
    onCommitted?: (result: CommitClose) => void;
  } = {},
): Promise<CommitClose> {
  const gitArgs = [...(options.gitArgs ?? [])];
  const args = analyzeCommitArgs(gitArgs);
  if (args.pathspecs.length > 0) {
    throw new GitracError(
      'invalid_input',
      `git commit pathspecs are not supported (${args.pathspecs.join(' ')}): git would commit only those paths and leave the issue out.`,
      { details: { reason: 'pathspec', pathspecs: args.pathspecs } },
    );
  }

  const { change, snapshot } = await withRepoLock(ctx.dir, async () => {
    // Save the issue file as it is now (it can have uncommitted changes).
    const before = (await findIssueFiles(ctx.dir, id)).map((f) => f.path);
    // Without an issue file, let the close report it (not found, ...).
    if (before.length > 0 && !args.all && !args.amend) {
      const staged = (await stagedFiles(ctx.dir)).filter(
        (p) => !before.includes(p),
      );
      if (staged.length === 0) {
        throw new GitracError(
          'invalid_input',
          'Nothing is staged besides the issue.',
          { details: { reason: 'nothing_staged' } },
        );
      }
    }
    const snapshot = await snapshotPaths(ctx.dir, before);
    const change = await closeIssue(
      { ...ctx, noCommit: true, onWritten: undefined },
      id,
      options,
    );
    try {
      // The other issue path that the close returns is the new file: there
      // was no file there before (a second file for the ID makes the close
      // fail). The close does not write assets, so keep them as they are.
      const added = await snapshotPaths(
        ctx.dir,
        change.paths.filter((p) => !snapshot.has(p)),
      );
      for (const [path, state] of added) {
        const isAsset = path.startsWith(ASSETS_DIR);
        snapshot.set(path, isAsset ? state : { ...state, file: null });
      }
      await stageFiles(ctx.dir, change.paths);
    } catch (err) {
      await restorePaths(ctx.dir, snapshot);
      throw err;
    }
    return { change, snapshot };
  });

  const head = await headCommit(ctx.dir);
  let exitCode: number | null;
  try {
    exitCode = await runGitCommit(ctx.dir, gitArgs, {
      stdout: options.gitStdout,
    });
  } catch (err) {
    await rollBack(ctx, snapshot);
    throw new GitracError('git_error', `git commit failed: ${String(err)}`, {
      details: { id },
      cause: err,
    });
  }
  const commit = await headCommit(ctx.dir);
  const committed = commit !== null && commit !== head;
  if (!committed) {
    await rollBack(ctx, snapshot);
    throw new GitracError(
      'git_error',
      exitCode !== 0
        ? `git commit failed (exit status ${exitCode ?? 'none'}); issue #${id} was not closed.`
        : `git commit made no commit; issue #${id} was not closed.`,
      { details: { id, exitCode } },
    );
  }
  if (exitCode !== 0) {
    // HEAD moved, so the commit (with the close) exists: keep it.
    throw new GitracError(
      'git_error',
      `git commit exited with status ${exitCode ?? 'none'} after it made commit ${commit}, which closes issue #${id}.`,
      { details: { id, exitCode, commit } },
    );
  }

  const result: CommitClose = {
    issue: change.issue,
    paths: change.paths,
    commit,
  };
  options.onCommitted?.(result);
  const config = await loadConfig(ctx);
  try {
    await pushIfConfigured(ctx.dir, config, { push: ctx.push });
  } catch (err) {
    if (!ctx.onPushError) throw err;
    ctx.onPushError(err);
  }
  return result;
}

/** Undo the close: put the issue files and index entries back. */
function rollBack(ctx: ServiceContext, snapshot: PathSnapshot): Promise<void> {
  return withRepoLock(ctx.dir, () => restorePaths(ctx.dir, snapshot));
}
