import simpleGit from 'simple-git';
import type { Config } from '../core/types.ts';

/**
 * Get the current branch name.
 */
export async function getCurrentBranch(dir: string): Promise<string> {
  const git = simpleGit(dir);
  const status = await git.status();
  return status.current ?? '';
}

/**
 * Get the default branch from config.
 */
export function getDefaultBranch(config: Config): string {
  return config.git.defaultBranch;
}

/**
 * Check if the current branch matches the config's default branch.
 */
export async function isOnDefaultBranch(
  dir: string,
  config: Config,
): Promise<boolean> {
  const current = await getCurrentBranch(dir);
  return current === getDefaultBranch(config);
}

/**
 * Get a warning message if not on the default branch, null otherwise.
 */
export async function getBranchWarning(
  dir: string,
  config: Config,
): Promise<string | null> {
  const current = await getCurrentBranch(dir);
  const defaultBranch = getDefaultBranch(config);
  if (current === defaultBranch) {
    return null;
  }
  return `You are on branch "${current}", not the default branch "${defaultBranch}".`;
}

/**
 * Check if all commits are pushed (or if there's no remote).
 * Returns true if no unpushed commits or no remote.
 */
export async function isPushed(dir: string): Promise<boolean> {
  const remote = await hasRemote(dir);
  if (!remote) {
    return true;
  }
  const git = simpleGit(dir);
  const status = await git.status();
  return status.ahead === 0;
}

/**
 * Check if the 'origin' remote exists.
 */
export async function hasRemote(dir: string): Promise<boolean> {
  const git = simpleGit(dir);
  const remotes = await git.getRemotes();
  return remotes.some((r) => r.name === 'origin');
}

/**
 * Get the git repository root directory.
 * Throws if not inside a git repository.
 */
export async function getGitRoot(dir: string): Promise<string> {
  const git = simpleGit(dir);
  const root = await git.revparse(['--show-toplevel']);
  return root.trim();
}
