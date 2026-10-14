import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import simpleGit from 'simple-git';
import { type LockOptions, withLock } from '../fs/lock.ts';

/** Name of the lockfile inside the git common dir. */
export const REPO_LOCK_NAME = 'gitrac.lock';

/** Cache of resolved git common dirs (non-git fallbacks are not cached). */
const commonDirCache = new Map<string, string>();

async function gitCommonDir(dir: string): Promise<string | null> {
  const cached = commonDirCache.get(dir);
  if (cached) return cached;
  try {
    const out = (await simpleGit(dir).revparse(['--git-common-dir'])).trim();
    if (!out) return null;
    const commonDir = isAbsolute(out) ? out : resolve(dir, out);
    commonDirCache.set(dir, commonDir);
    return commonDir;
  } catch {
    return null;
  }
}

/**
 * Path of the repo-wide gitrac lock: `$(git rev-parse --git-common-dir)/gitrac.lock`.
 * Using the common dir means all worktrees of a repository share one lock.
 *
 * Outside a git repo (e.g. tests, or a server pointed at a plain directory)
 * mutations are still serialized, using a per-directory lock in the OS temp dir.
 */
export async function repoLockPath(dir: string): Promise<string> {
  const abs = resolve(dir);
  const commonDir = await gitCommonDir(abs);
  if (commonDir) {
    return join(commonDir, REPO_LOCK_NAME);
  }
  const hash = createHash('sha256').update(abs).digest('hex');
  return join(tmpdir(), `gitrac-${hash.slice(0, 16)}.lock`);
}

/**
 * Run `fn` while holding the repo-wide gitrac lock. Every gitrac mutation
 * (read-modify-write of issue/config files plus the git commit and push) must
 * run inside this, from both the CLI and the web server. Re-entrant.
 */
export async function withRepoLock<T>(
  dir: string,
  fn: () => Promise<T> | T,
  options?: LockOptions,
): Promise<T> {
  return withLock(await repoLockPath(dir), fn, options);
}
