import {
  type BranchState,
  branchBlocker,
  headDescription,
  switchBlocker,
} from '../../../core/branches.ts';

/**
 * What the sidebar's branch indicator and picker show (`BranchSwitcher`),
 * from `GET /api/git/branches`. The rules are the server's
 * (`src/core/branches.ts`), so the picker disables what the server refuses.
 */

/** One `<option>` of the picker. */
export interface BranchOption {
  /** The branch name; `''` for the detached-HEAD placeholder. */
  value: string;
  label: string;
  disabled: boolean;
  /** Why it is disabled (the option's tooltip). */
  reason?: string;
}

export interface BranchPickerView {
  /** The indicator text: the branch, or `detached at <sha>`. */
  label: string;
  /** The selected option's value (`''` when HEAD is detached). */
  value: string;
  options: BranchOption[];
  /**
   * Why no switch is possible now (an operation in progress, modified
   * tracked files), or null. Set: the picker is disabled with this tooltip.
   */
  disabledReason: string | null;
  /** True if there is no other branch to switch to. */
  onlyBranch: boolean;
}

export function branchPickerView(state: BranchState): BranchPickerView {
  const options: BranchOption[] = [];
  if (state.current === null) {
    options.push({
      value: '',
      label: headDescription(state),
      disabled: true,
    });
  }
  for (const branch of state.branches) {
    const reason = branch.current ? null : branchBlocker(branch);
    options.push({
      value: branch.name,
      label: branch.current
        ? `${branch.name} (current)`
        : branch.worktree
          ? `${branch.name} (in another worktree)`
          : branch.uninitialized
            ? `${branch.name} (no gitrac)`
            : branch.name,
      disabled: reason !== null,
      ...(reason ? { reason } : {}),
    });
  }
  const switchable = state.branches.some(
    (b) => !b.current && branchBlocker(b) === null,
  );
  return {
    label: headDescription(state),
    value: state.current ?? '',
    options,
    disabledReason: switchBlocker(state),
    onlyBranch: !switchable,
  };
}

/** The confirmation question before a switch. */
export function switchPrompt(from: BranchState, to: string): string {
  return `Switch this worktree from ${headDescription(from)} to branch "${to}"? Open pages show the issues on "${to}".`;
}
