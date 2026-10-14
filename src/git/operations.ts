import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import simpleGit, { type SimpleGit } from 'simple-git';
import type { Config } from '../core/types.ts';
import { withRepoLock } from './lock.ts';
import { hasRemote } from './status.ts';

/** Turn a path into a literal pathspec (no glob / magic interpretation). */
function literal(path: string): string {
  return `:(literal)${path}`;
}

async function existsOnDisk(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stage exactly the given paths and return the literal pathspecs that a
 * path-limited (`--only`) commit should include.
 *
 * - Paths present on disk are staged with `git add -A` (new or modified).
 * - Paths missing from disk (deleted / renamed away) are kept only if git
 *   knows them (index or HEAD), so `git commit --only` records the deletion.
 * - Paths git has never seen and that don't exist are dropped (nothing to
 *   commit for them, and passing them would make git error out).
 */
async function stagePaths(
  git: SimpleGit,
  dir: string,
  files: string[],
): Promise<string[]> {
  const unique = [...new Set(files)];
  const present = await Promise.all(
    unique.map((f) => existsOnDisk(resolve(dir, f))),
  );
  const onDisk = unique.filter((_, i) => present[i]);
  const missing = unique.filter((_, i) => !present[i]);

  if (onDisk.length > 0) {
    await git.raw(['add', '-A', '--', ...onDisk.map(literal)]);
  }

  const hasHead = (
    await git
      .raw(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
      .catch(() => '')
  ).trim();
  const known = await Promise.all(
    missing.map((f) =>
      git
        .raw([
          'ls-files',
          '--error-unmatch',
          ...(hasHead ? ['--with-tree=HEAD'] : []),
          '--',
          literal(f),
        ])
        .then(
          () => true,
          () => false,
        ),
    ),
  );

  return [...onDisk, ...missing.filter((_, i) => known[i])].map(literal);
}

/**
 * Create (or amend) a commit containing ONLY the given paths, regardless of
 * whatever else is staged in the index. Uses `git commit --only -- <paths>`,
 * so pre-existing staged changes to other paths stay staged and uncommitted.
 *
 * Returns the commit hash, or null if nothing was committed.
 */
export async function commitPaths(
  dir: string,
  files: string[],
  message: string,
  options?: { amend?: boolean },
): Promise<string | null> {
  // Re-entrant: a no-op when the caller already holds the repo lock (as every
  // mutation should); otherwise at least serializes the git index/HEAD update.
  return withRepoLock(dir, () =>
    commitPathsLocked(dir, files, message, options),
  );
}

async function commitPathsLocked(
  dir: string,
  files: string[],
  message: string,
  options?: { amend?: boolean },
): Promise<string | null> {
  const git = simpleGit(dir);
  const pathspecs = await stagePaths(git, dir, files);
  const amend = options?.amend ?? false;
  if (pathspecs.length === 0 && !amend) {
    // A pathless `git commit` would commit the whole index; never do that.
    return null;
  }
  // With --amend, a bare --only (no paths) rewrites just the message and
  // ignores the index. Pathspecs all start with `:(literal)`, so they can't be
  // mistaken for options even though simple-git places them before the flags.
  const result = await git.commit(message, pathspecs, {
    ...(amend ? { '--amend': null } : {}),
    '--only': null,
  });
  return result.commit || null;
}

/**
 * Stage files and create a commit containing only those files. Returns the
 * commit hash. Other staged changes in the index are left staged and are not
 * included. If noCommit is true, returns null without committing.
 */
export async function commitIssueChange(
  dir: string,
  files: string[],
  message: string,
  options?: { noCommit?: boolean },
): Promise<string | null> {
  if (options?.noCommit) {
    return null;
  }
  return commitPaths(dir, files, message);
}

/**
 * Push to origin if configured and appropriate.
 * Flag > config. Does nothing if no remote.
 *
 * Priority:
 * 1. noPush flag = never push
 * 2. push flag = always push (if remote exists)
 * 3. config.git.autoPush = push if true (if remote exists)
 */
export async function pushIfConfigured(
  dir: string,
  config: Config,
  flags: { push?: boolean; noPush?: boolean },
): Promise<void> {
  if (flags.noPush) {
    return;
  }
  const shouldPush = flags.push ?? config.git.autoPush;
  if (!shouldPush) {
    return;
  }
  const remote = await hasRemote(dir);
  if (!remote) {
    return;
  }
  await withRepoLock(dir, () => simpleGit(dir).push());
}

/**
 * Pull with rebase. No-op if no remote.
 */
export async function pullRebase(dir: string): Promise<void> {
  const remote = await hasRemote(dir);
  if (!remote) {
    return;
  }
  await withRepoLock(dir, () => simpleGit(dir).pull(['--rebase']));
}
