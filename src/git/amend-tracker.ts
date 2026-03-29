import simpleGit from 'simple-git';
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
}
