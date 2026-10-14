import { realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import simpleGit from 'simple-git';
import { differsOnlyInUpdated } from '../core/issue.ts';
import { commitIssueChange } from './operations.ts';
import { hasRemote } from './status.ts';

/**
 * Tracks whether a commit can be amended (for web UI batch edits).
 * Stores the issue ID and commit hash of the last operation.
 * Amend is allowed only if:
 * - Same issue ID
 * - HEAD matches the stored hash
 * - Not pushed to remote
 */
export class AmendTracker {
  private issueId: number | null = null;
  private commitHash: string | null = null;

  /**
   * Record an amendable commit state.
   */
  record(issueId: number, commitHash: string): void {
    this.issueId = issueId;
    this.commitHash = commitHash;
  }

  /**
   * Check if the current HEAD can be amended for the given issue.
   */
  async canAmend(dir: string, issueId: number): Promise<boolean> {
    if (this.issueId !== issueId || !this.commitHash) {
      return false;
    }
    const git = simpleGit(dir);
    const head = await git.revparse(['HEAD']);
    if (!head.trim().startsWith(this.commitHash)) {
      return false;
    }
    // If there's no remote, commit can't be pushed, so always amendable
    const remote = await hasRemote(dir);
    if (!remote) {
      return true;
    }
    // If there's a remote, check if HEAD is ahead (unpushed)
    const git2 = simpleGit(dir);
    const status = await git2.status();
    return status.ahead > 0;
  }

  /**
   * Clear the tracked state.
   */
  clear(): void {
    this.issueId = null;
    this.commitHash = null;
  }

  /**
   * Amend the HEAD commit with new files and message.
   * Returns the new commit hash.
   */
  async amend(dir: string, files: string[], message: string): Promise<string> {
    const git = simpleGit(dir);
    await git.add(files);
    const result = await git.commit(message, undefined, { '--amend': null });
    return result.commit;
  }

  /**
   * After amending, check if the commit is effectively a no-op relative to
   * its parent: every file it touches is one of the gitrac-managed `files`
   * and differs only in the issue frontmatter `updated:` timestamp. If so,
   * drop the commit.
   *
   * The drop is non-destructive: `git reset --soft HEAD~1` moves HEAD only,
   * then just the dropped commit's files are restored (index + working tree)
   * to the parent's version. Unrelated staged or unstaged changes are never
   * touched.
   */
  async dropIfNoOp(dir: string, files: string[]): Promise<boolean> {
    const git = simpleGit(dir);

    // Can't drop a root commit
    const parent = await git
      .raw(['rev-parse', '--verify', '--quiet', 'HEAD~1^{commit}'])
      .catch(() => '');
    if (!parent.trim()) {
      return false;
    }

    const toplevel = await realpath(
      (await git.revparse(['--show-toplevel'])).trim(),
    );
    const realDir = await realpath(dir);
    const toRepoPath = (f: string) =>
      relative(toplevel, resolve(realDir, f)).split(sep).join('/');
    const managed = new Set(files.map(toRepoPath));

    // Paths are relative to the repo toplevel; -z avoids path quoting
    const raw = await git.raw([
      'diff',
      '--name-status',
      '--no-renames',
      '-z',
      'HEAD~1',
      'HEAD',
    ]);
    const parts = raw.split('\0').filter((p) => p !== '');
    const changed: { status: string; path: string }[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      changed.push({ status: parts[i] ?? '', path: parts[i + 1] ?? '' });
    }

    for (const { status, path } of changed) {
      // Only modifications of gitrac-managed issue files can be no-ops
      if (status !== 'M' || !managed.has(path) || !path.endsWith('.md')) {
        return false;
      }
      const [before, after] = await Promise.all([
        git.show([`HEAD~1:${path}`]),
        git.show([`HEAD:${path}`]),
      ]);
      if (!differsOnlyInUpdated(before, after)) {
        return false;
      }
    }

    await git.reset(['--soft', 'HEAD~1']);
    if (changed.length > 0) {
      // Restore only the files from the dropped commit, so disk matches HEAD
      await simpleGit(toplevel).raw([
        'restore',
        '--source=HEAD',
        '--staged',
        '--worktree',
        '--',
        ...changed.map((c) => `:(literal)${c.path}`),
      ]);
    }
    this.clear();
    return true;
  }

  /**
   * Commit or amend based on whether the last commit for this issue
   * is still the HEAD and hasn't been pushed. This is the standard
   * pattern all web routes should use.
   */
  async commitOrAmend(
    dir: string,
    issueId: number,
    files: string[],
    message: string,
  ): Promise<void> {
    const canAmendResult = await this.canAmend(dir, issueId);
    if (canAmendResult) {
      const hash = await this.amend(dir, files, message);
      const dropped = await this.dropIfNoOp(dir, files);
      if (!dropped) {
        this.record(issueId, hash);
      }
    } else {
      const hash = await commitIssueChange(dir, files, message);
      if (hash) {
        this.record(issueId, hash);
      }
    }
  }
}
