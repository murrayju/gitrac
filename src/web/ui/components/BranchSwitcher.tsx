import { useEffect, useState, useSyncExternalStore } from 'react';
import { fetchBranches, switchBranch } from '../api.ts';
import { refetchGitStatus, useConfig } from '../hooks.ts';
import { branchPickerView, switchPrompt } from '../lib/branch-picker.ts';
import { issueEvents } from '../lib/event-stream.ts';
import { elsewhereRefresh } from '../lib/refresh-timer.ts';
import { createSharedQuery } from '../lib/shared-query.ts';
import { requestErrorReason } from '../lib/upload-error.ts';

// The branch state, refetched on every issue change and on the shared
// periodic tick (a `git switch` in a terminal sends no event when the
// issue files are the same on both branches).
const branchQuery = createSharedQuery(fetchBranches, (refetch) => {
  const stopEvents = issueEvents().subscribe(refetch);
  const stopTimer = elsewhereRefresh().subscribe(refetch);
  return () => {
    stopEvents();
    stopTimer();
  };
});

function refetchBranches(): void {
  void branchQuery.refetch();
}

/**
 * Sidebar indicator of the checked-out branch (or `detached at <sha>`), with
 * a picker to switch to another local branch. The picker is disabled while
 * a switch is not possible (modified tracked files, a merge or rebase in
 * progress); branches checked out in another worktree are listed but
 * disabled.
 */
export function BranchSwitcher() {
  const { data: state } = useSyncExternalStore(
    branchQuery.subscribe,
    branchQuery.getSnapshot,
  );
  const { refetch: refetchConfig } = useConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The branch may change outside the browser (a terminal).
  useEffect(() => {
    window.addEventListener('focus', refetchBranches);
    return () => window.removeEventListener('focus', refetchBranches);
  }, []);

  if (!state) return null;
  const view = branchPickerView(state);

  async function onChange(branch: string) {
    if (!state || !branch || branch === state.current) return;
    if (!window.confirm(switchPrompt(state, branch))) return;
    setBusy(true);
    setError(null);
    try {
      const result = await switchBranch(branch);
      branchQuery.set(result.state);
    } catch (e) {
      setError(requestErrorReason(e));
      refetchBranches();
    } finally {
      setBusy(false);
      // The banner, the config and the branch list can differ per branch.
      refetchGitStatus();
      refetchConfig();
    }
  }

  const disabled = busy || view.disabledReason !== null || view.onlyBranch;
  const title =
    view.disabledReason ??
    (view.onlyBranch ? 'No other branch to switch to' : 'Switch branch');

  return (
    <div className="text-xs text-gray-500">
      <label className="block">
        <span className="block mb-1">Branch</span>
        <select
          value={view.value}
          disabled={disabled}
          title={title}
          onChange={(e) => void onChange(e.target.value)}
          className="select-caret w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 pl-1.5 py-1 text-xs font-mono disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {view.options.map((o) => (
            <option
              key={o.value || '(detached)'}
              value={o.value}
              disabled={o.disabled}
              title={o.reason}
            >
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {view.disabledReason && (
        <p className="mt-1 text-amber-600 dark:text-amber-400">
          {state.operation ? 'Operation in progress' : 'Uncommitted changes'}:
          switching is disabled.
        </p>
      )}
      {busy && <p className="mt-1">Switching...</p>}
      {error && (
        <p role="alert" className="mt-1 text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
