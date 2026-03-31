import simpleGit from 'simple-git';
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
   * After amending, check if the commit is effectively a no-op
   * (only the `updated` timestamp changed). If so, drop the commit
   * by resetting HEAD back one.
   */
  async dropIfNoOp(dir: string): Promise<boolean> {
    const git = simpleGit(dir);

    // Get the diff between HEAD and its parent
    const diff = await git.diff(['HEAD~1', 'HEAD']);

    // If there's no diff at all, drop
    if (!diff.trim()) {
      await git.reset(['--hard', 'HEAD~1']);
      this.clear();
      return true;
    }

    // Check if all changed lines are just `updated:` timestamp changes
    const lines = diff.split('\n');
    const changedLines = lines.filter(
      (l) =>
        (l.startsWith('+') || l.startsWith('-')) &&
        !l.startsWith('+++') &&
        !l.startsWith('---'),
    );

    // Every changed line should be an `updated:` timestamp line
    const isNoOp =
      changedLines.length > 0 &&
      changedLines.every((l) => /^[+-]updated:\s/.test(l));

    if (isNoOp) {
      await git.reset(['--hard', 'HEAD~1']);
      this.clear();
      return true;
    }

    return false;
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
      const dropped = await this.dropIfNoOp(dir);
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
