import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type BranchState,
  DIRTY_PATHS_SHOWN,
  type GitOperation,
  parseBranchList,
  parsePorcelainPaths,
} from '../core/branches.ts';
import { GitracError } from '../core/errors.ts';
import { gitText, resolveObjects } from './objects.ts';

/**
 * Read and change the checked-out branch of a worktree, for the web UI's
 * branch switcher. The rules (what is listed, when a switch is allowed) are
 * in `src/core/branches.ts`.
 */

/** Repo-relative path of the gitrac config, which every gitrac branch has. */
const CONFIG_SPEC = './.issues/config.yaml';

/**
 * Files in the git dir that show an operation in progress, in the order they
 * are checked. `rebase-apply/applying` is a `git am`; other `rebase-apply`
 * states are a rebase.
 */
const OPERATION_MARKERS: readonly [string, GitOperation][] = [
  ['rebase-merge', 'rebase'],
  ['rebase-apply/applying', 'am'],
  ['rebase-apply', 'rebase'],
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['BISECT_LOG', 'bisect'],
];

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The git operation in progress in this worktree, or null. */
export async function operationInProgress(
  dir: string,
): Promise<GitOperation | null> {
  const out = await gitText(dir, [
    'rev-parse',
    ...OPERATION_MARKERS.flatMap(([marker]) => ['--git-path', marker]),
  ]);
  if (out === null) return null;
  const paths = out.split('\n');
  const found = await Promise.all(
    OPERATION_MARKERS.map((_, i) => {
      const path = paths[i];
      return path ? exists(resolve(dir, path)) : false;
    }),
  );
  const index = found.indexOf(true);
  return index < 0 ? null : (OPERATION_MARKERS[index]?.[1] ?? null);
}

/** Modified or staged tracked paths (untracked files are left out). */
export async function dirtyTrackedPaths(dir: string): Promise<string[]> {
  const out = await gitText(dir, [
    'status',
    '--porcelain',
    '-z',
    '--untracked-files=no',
  ]);
  if (out === null) {
    throw new GitracError('git_error', 'git status failed');
  }
  return parsePorcelainPaths(out);
}

/**
 * The branch state of the worktree at `dir`: the current branch (null if
 * HEAD is detached), the short HEAD hash, the local branches (each with the
 * other worktree that has it checked out, if any, and `uninitialized` if its
 * tree has no `.issues/config.yaml`), whether tracked files are modified or
 * staged, and the operation in progress. Throws `git_error` if `dir` is not
 * in a git work tree.
 */
export async function readBranchState(dir: string): Promise<BranchState> {
  const [symbolic, head, refs, dirtyPaths, operation] = await Promise.all([
    gitText(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    gitText(dir, ['rev-parse', '--short', '--verify', '--quiet', 'HEAD']),
    gitText(dir, [
      'for-each-ref',
      '--format=%(HEAD)%00%(refname)%00%(worktreepath)',
      'refs/heads',
    ]),
    dirtyTrackedPaths(dir),
    operationInProgress(dir),
  ]);
  if (refs === null) {
    throw new GitracError('git_error', 'git for-each-ref failed');
  }
  const current = symbolic?.trim() || null;
  const branches = parseBranchList(refs, current);
  const configs = await resolveObjects(
    dir,
    branches.map((b) => `refs/heads/${b.name}:${CONFIG_SPEC}`),
  );
  return {
    current,
    detached: current === null,
    head: head?.trim() ?? '',
    branches: branches.map((b, i) =>
      // The current branch is what is checked out, so it is never marked.
      // A failed lookup (`configs` null) marks nothing.
      b.current || !configs || configs[i] ? b : { ...b, uninitialized: true },
    ),
    dirty: dirtyPaths.length > 0,
    dirtyPaths: dirtyPaths.slice(0, DIRTY_PATHS_SHOWN),
    dirtyCount: dirtyPaths.length,
    operation,
  };
}

/**
 * Run `git switch <branch>` in `dir` (no create, no detach, no guess from a
 * remote-tracking branch). The caller makes sure `branch` is a listed local
 * branch. Throws `git_error` with git's message if git refuses (e.g. an
 * untracked file would be overwritten).
 */
export async function gitSwitch(dir: string, branch: string): Promise<void> {
  const proc = Bun.spawn(['git', 'switch', '--no-guess', '--', branch], {
    cwd: dir,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    const detail = stderr.trim().replace(/^(fatal|error): /, '');
    throw new GitracError(
      'git_error',
      `git switch failed: ${detail || `exit code ${code}`}`,
      { details: { exitCode: code } },
    );
  }
}
