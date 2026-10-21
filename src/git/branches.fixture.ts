import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { initIssuesDir } from '../fs/issue-store.ts';

/** A temp repo for the branch switcher tests (see {@link branchRepo}). */
export interface BranchRepo {
  /** The temp directory that holds the repo (and any extra worktrees). */
  base: string;
  /** The repo's main worktree. */
  dir: string;
  cleanup(): Promise<void>;
}

/**
 * A repo on `main` with gitrac initialized, a README, and the branches
 * `feature` (one commit ahead, changes README) and `plain` (an orphan
 * branch with no `.issues/`, which tracks `other.txt`).
 */
export async function branchRepo(): Promise<BranchRepo> {
  const base = await realpath(
    await mkdtemp(join(tmpdir(), 'gitrac-branches-')),
  );
  const dir = join(base, 'repo');
  await mkdir(dir);
  const git = simpleGit(dir);
  await git.init(['--initial-branch=main']);
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await writeFile(join(dir, 'README.md'), 'hello\n');
  await initIssuesDir(dir);
  await git.add('.');
  await git.commit('initial');
  await git.raw(['switch', '-q', '-c', 'feature']);
  await writeFile(join(dir, 'README.md'), 'feature\n');
  await git.commit('feature', ['README.md']);
  await git.raw(['switch', '-q', 'main']);
  await git.raw(['switch', '-q', '--orphan', 'plain']);
  await writeFile(join(dir, 'other.txt'), 'x\n');
  await git.add('other.txt');
  await git.commit('plain');
  await git.raw(['switch', '-q', '-f', 'main']);
  await rm(join(dir, 'other.txt'), { force: true });
  return {
    base,
    dir,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

/** Commit a change to README on `main` and start a conflicting merge. */
export async function startConflictingMerge(dir: string): Promise<void> {
  const git = simpleGit(dir);
  await writeFile(join(dir, 'README.md'), 'main\n');
  await git.commit('main change', ['README.md']);
  await git.raw(['merge', 'feature']).catch(() => {});
}
