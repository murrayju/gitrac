import {
  type BranchState,
  branchNameError,
  decideSwitch,
} from '../core/branches.ts';
import { invalidInput } from '../core/errors.ts';
import { gitSwitch, readBranchState } from '../git/branches.ts';
import { withRepoLock } from '../git/lock.ts';
import type { ServiceContext } from './context.ts';

/** What {@link switchBranch} did. */
export interface BranchSwitch {
  /** The branch checked out before. Null if HEAD was detached. */
  previous: string | null;
  /** The branch state after the switch. */
  state: BranchState;
  /** False if `branch` was already checked out (nothing was done). */
  switched: boolean;
}

/**
 * Check out the local branch `branch` in the worktree at `ctx.dir` (the web UI's
 * branch switcher). Under the repo lock, so no gitrac write runs in the
 * middle of it. The rules are `decideSwitch` (`src/core/branches.ts`):
 * `invalid_input` for a bad name or a branch that is not a local branch,
 * `invalid_state` for a branch checked out in another worktree or with no
 * gitrac config, an operation in progress (merge, rebase, ...) or modified
 * or staged tracked files. Untracked files are kept; if git refuses because
 * one would be overwritten, that is a `git_error` with git's message.
 * Switching to the current branch does nothing.
 *
 * The caller resets what depends on the checked-out commit (the web
 * server's amend tracker, its scan cache and its config).
 */
export async function switchBranch(
  ctx: Pick<ServiceContext, 'dir'>,
  branch: unknown,
): Promise<BranchSwitch> {
  const { dir } = ctx;
  const error = branchNameError(branch);
  if (error) throw invalidInput(error);
  const name = branch as string;
  return withRepoLock(dir, async () => {
    const before = await readBranchState(dir);
    if (decideSwitch(before, name) === 'noop') {
      return { previous: before.current, state: before, switched: false };
    }
    await gitSwitch(dir, name);
    return {
      previous: before.current,
      state: await readBranchState(dir),
      switched: true,
    };
  });
}
