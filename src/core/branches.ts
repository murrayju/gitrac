import { GitracError } from './errors.ts';

/**
 * Rules for the web UI's branch switcher (pure; no I/O). The git layer
 * (`src/git/branches.ts`) reads the repo state; these functions decide what
 * the picker lists and whether a switch is allowed.
 */

/** A local branch (`refs/heads/*`). */
export interface BranchInfo {
  /** Short name, e.g. `main`. */
  name: string;
  /** True for the branch checked out in this worktree. */
  current: boolean;
  /**
   * Set when the branch is checked out in another worktree (its path). Git
   * does not check out one branch in two worktrees, so a switch to it fails.
   */
  worktree?: string;
  /**
   * True if the branch has no `.issues/config.yaml` (gitrac is not set up
   * there). A switch to it would remove the issues the server works on.
   */
  uninitialized?: boolean;
}

/** A git operation that stops in the middle (and blocks a switch). */
export type GitOperation =
  | 'merge'
  | 'rebase'
  | 'am'
  | 'cherry-pick'
  | 'revert'
  | 'bisect';

/** The branch state of this worktree (`GET /api/git/branches`). */
export interface BranchState {
  /** The checked-out branch, or null for a detached HEAD. */
  current: string | null;
  detached: boolean;
  /** Short hash of HEAD (empty on an unborn branch). */
  head: string;
  /** Local branches, sorted by name. */
  branches: BranchInfo[];
  /** True if tracked files are modified or staged (untracked files do not count). */
  dirty: boolean;
  /** Some of the modified or staged paths (at most {@link DIRTY_PATHS_SHOWN}). */
  dirtyPaths: string[];
  /** How many tracked paths are modified or staged. */
  dirtyCount: number;
  /** The operation in progress, or null. */
  operation: GitOperation | null;
}

/** How many dirty paths a message or a tooltip names. */
export const DIRTY_PATHS_SHOWN = 5;

/** `refs/heads/` prefix of a local branch ref. */
const HEADS_PREFIX = 'refs/heads/';

/**
 * Parse `git for-each-ref --format=%(HEAD)%00%(refname)%00%(worktreepath)
 * refs/heads` output into branches, sorted by name. `%(HEAD)` is `*` for the
 * branch checked out in this worktree; `%(worktreepath)` is set for each
 * branch that a worktree (this one or another) has checked out. If `current`
 * (the branch HEAD points at) is not in the list (an unborn branch), it is
 * added as the current branch.
 */
export function parseBranchList(
  out: string,
  current: string | null,
): BranchInfo[] {
  const branches: BranchInfo[] = [];
  for (const line of out.split('\n')) {
    const [head, refname, worktree] = line.split('\0');
    if (!refname?.startsWith(HEADS_PREFIX)) continue;
    const name = refname.slice(HEADS_PREFIX.length);
    const isCurrent = head === '*';
    branches.push({
      name,
      current: isCurrent,
      ...(!isCurrent && worktree ? { worktree } : {}),
    });
  }
  if (current !== null && !branches.some((b) => b.name === current)) {
    branches.push({ name: current, current: true });
  }
  return branches.sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

/**
 * Parse `git status --porcelain -z` output into paths. A rename or copy
 * entry is followed by its source path, which is skipped.
 */
export function parsePorcelainPaths(out: string): string[] {
  const parts = out.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? '';
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (xy.includes('R') || xy.includes('C')) i++;
  }
  return paths;
}

/**
 * Why `name` can't be a branch name for a switch, or null if it can. Checked
 * before the repo state is read, so the input error comes first. A name that
 * starts with `-` is refused, so git never reads it as an option.
 */
export function branchNameError(name: unknown): string | null {
  if (typeof name !== 'string' || name.trim() === '') {
    return 'Branch name is required';
  }
  if (name.startsWith('-')) {
    return `Invalid branch name ${JSON.stringify(name)}: must not start with "-"`;
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control chars are refused
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return `Invalid branch name ${JSON.stringify(name)}: must not contain control characters`;
  }
  return null;
}

/** Human name of an operation, for messages (`a merge`, `a cherry-pick`). */
export function operationText(operation: GitOperation): string {
  switch (operation) {
    case 'am':
      return 'a "git am"';
    case 'bisect':
      return 'a bisect';
    default:
      return `a ${operation}`;
  }
}

/** `a.md, b.md and 3 more` for a message. */
export function dirtyPathsText(
  paths: readonly string[],
  total: number,
): string {
  const shown = paths.slice(0, DIRTY_PATHS_SHOWN);
  const more = total - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

/** The current branch, or `detached at <sha>` (the indicator text). */
export function headDescription(
  state: Pick<BranchState, 'current' | 'head'>,
): string {
  if (state.current !== null) return state.current;
  return state.head ? `detached at ${state.head}` : 'detached HEAD';
}

/**
 * Why the working tree can't switch to any branch now (an operation in
 * progress, or modified tracked files), or null if it can.
 */
export function switchBlocker(
  state: Pick<BranchState, 'dirty' | 'dirtyPaths' | 'dirtyCount' | 'operation'>,
): string | null {
  if (state.operation) {
    return `${capitalize(operationText(state.operation))} is in progress; finish or abort it before switching branches.`;
  }
  if (state.dirty) {
    const paths = state.dirtyPaths.length
      ? ` (${dirtyPathsText(state.dirtyPaths, state.dirtyCount)})`
      : '';
    return `The working tree has uncommitted changes to tracked files${paths}; commit or stash them before switching branches.`;
  }
  return null;
}

/** Why git can't check out `branch` here, or null if it can. */
export function branchBlocker(branch: BranchInfo): string | null {
  if (branch.worktree) {
    return `Branch "${branch.name}" is checked out in worktree ${branch.worktree}.`;
  }
  if (branch.uninitialized) {
    return `Branch "${branch.name}" has no .issues/config.yaml (gitrac is not initialized there).`;
  }
  return null;
}

/**
 * Decide a switch to `name` (already checked with {@link branchNameError}).
 * Returns `noop` if it is the current branch; throws `invalid_input` if it
 * is not a local branch, and `invalid_state` if it is checked out in
 * another worktree, has no gitrac config, an operation is in progress or tracked files are
 * modified.
 */
export function decideSwitch(
  state: BranchState,
  name: string,
): 'switch' | 'noop' {
  const branch = state.branches.find((b) => b.name === name);
  if (!branch) {
    throw new GitracError(
      'invalid_input',
      `Unknown branch ${JSON.stringify(name)}: not a local branch`,
      { details: { branch: name } },
    );
  }
  if (branch.current) return 'noop';
  const elsewhere = branchBlocker(branch);
  if (elsewhere) {
    throw new GitracError('invalid_state', elsewhere, {
      details: branch.worktree
        ? { branch: name, worktree: branch.worktree }
        : { branch: name },
    });
  }
  const blocked = switchBlocker(state);
  if (blocked) {
    throw new GitracError('invalid_state', blocked, {
      details: state.operation
        ? { operation: state.operation }
        : { paths: state.dirtyPaths },
    });
  }
  return 'switch';
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
