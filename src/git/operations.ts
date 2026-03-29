import simpleGit from 'simple-git';
import type { Config } from '../core/types.ts';
import { hasRemote } from './status.ts';

/**
 * Stage files and create a commit. Returns the commit hash.
 * If noCommit is true, returns null without committing.
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
  const git = simpleGit(dir);
  await git.add(files);
  const result = await git.commit(message);
  return result.commit || null;
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
  const git = simpleGit(dir);
  await git.push();
}

/**
 * Pull with rebase. No-op if no remote.
 */
export async function pullRebase(dir: string): Promise<void> {
  const remote = await hasRemote(dir);
  if (!remote) {
    return;
  }
  const git = simpleGit(dir);
  await git.pull(['--rebase']);
}
