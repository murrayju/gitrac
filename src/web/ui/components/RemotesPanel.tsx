import type { RemoteSyncStatus, SyncOperation } from '../../../core/sync.ts';
import { arrows, fetchedAgo, outcomeText } from '../lib/sync.ts';
import { useSync } from '../sync-hooks.ts';

const BUTTON =
  'rounded border border-gray-300 dark:border-gray-700 px-2 py-0.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50';

const OPERATIONS: { operation: SyncOperation; label: string; title: string }[] =
  [
    { operation: 'fetch', label: 'Fetch', title: 'Download new commits' },
    {
      operation: 'pull',
      label: 'Pull',
      title: 'Fetch and merge (fast-forward if possible; never rebases)',
    },
    {
      operation: 'push',
      label: 'Push',
      title: 'Push this branch (fast-forward only; never forced)',
    },
    { operation: 'sync', label: 'Sync', title: 'Fetch, merge, then push' },
  ];

/**
 * The advanced sync view (`/remotes`): every remote with its URL, how far
 * the current branch is ahead/behind it, the last fetch, whether the simple
 * sync includes it, and Fetch / Pull / Push / Sync for that remote alone.
 */
export function RemotesPanel() {
  const {
    status,
    statusError,
    busy,
    problems,
    lastResult,
    requestError,
    actions,
  } = useSync();

  if (!status) {
    return (
      <div className="p-6 text-sm text-gray-500">
        {statusError ?? 'Loading\u2026'}
      </div>
    );
  }

  const branch = status.branch;
  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold">Remotes</h1>
        <div className="flex gap-2">
          <button
            type="button"
            className={BUTTON}
            disabled={busy !== null}
            onClick={() => void actions.run('fetch')}
          >
            Fetch included
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={busy !== null || !branch || status.operation !== null}
            onClick={() => void actions.run('sync')}
          >
            Sync included
          </button>
        </div>
      </div>
      <p className="mb-4 text-sm text-gray-500">
        {branch ? (
          <>
            Branch <strong>{branch}</strong> compared with{' '}
            <code>
              {'<remote>'}/{branch}
            </code>
            . Sync fetches, merges (never rebases) and pushes (never forces) the
            included remotes. Inclusion is stored in this clone's git config.
          </>
        ) : (
          'HEAD is detached: switch to a branch to sync.'
        )}
      </p>

      {requestError && (
        <div
          role="alert"
          className="mb-3 text-sm text-red-600 dark:text-red-400"
        >
          {requestError}
        </div>
      )}
      {lastResult && (
        <div className="mb-3 rounded border border-gray-200 dark:border-gray-800 p-2 text-sm">
          <div className="flex justify-between">
            <span className="font-medium">
              {lastResult.operation}: {lastResult.ok ? 'done' : 'problems'}
            </span>
            <button
              type="button"
              className="text-xs text-gray-500 hover:text-gray-700"
              onClick={actions.dismiss}
            >
              Dismiss
            </button>
          </div>
          <ul className="mt-1">
            {lastResult.remotes.length === 0 && (
              <li className="text-gray-500">No remote was used.</li>
            )}
            {lastResult.remotes.map((r) => (
              <li
                key={r.remote}
                className={r.error ? 'text-red-600 dark:text-red-400' : ''}
              >
                <strong>{r.remote}</strong>: {outcomeText(r)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {status.remotes.length === 0 ? (
        <div className="text-sm text-gray-500">
          This repository has no remotes. Add one with{' '}
          <code>git remote add origin {'<url>'}</code>.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="px-2 py-2">Remote</th>
                <th className="px-2 py-2">State</th>
                <th className="px-2 py-2">Included</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {status.remotes.map((remote) => (
                <RemoteRow
                  key={remote.name}
                  remote={remote}
                  branch={branch}
                  disabled={busy !== null || status.operation !== null}
                  busyOperation={
                    busy?.remote === remote.name ? busy.operation : null
                  }
                  problem={
                    problems.find((p) => p.remote === remote.name)?.error
                      .message ?? null
                  }
                  onRun={(operation) =>
                    void actions.run(operation, remote.name)
                  }
                  onInclude={(included) =>
                    void actions.setIncluded(remote.name, included)
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RemoteRow({
  remote,
  branch,
  disabled,
  busyOperation,
  problem,
  onRun,
  onInclude,
}: {
  remote: RemoteSyncStatus;
  branch: string | null;
  disabled: boolean;
  busyOperation: SyncOperation | null;
  problem: string | null;
  onRun: (operation: SyncOperation) => void;
  onInclude: (included: boolean) => void;
}) {
  const state = !branch
    ? '-'
    : !remote.hasBranch
      ? `no ${branch} on ${remote.name}`
      : arrows(remote.ahead, remote.behind) || 'in sync';
  const conflicts = remote.conflicts?.length ? remote.conflicts : null;
  return (
    <tr className="border-b border-gray-200/50 dark:border-gray-800/50 align-top">
      <td className="px-2 py-2">
        <div className="font-medium">{remote.name}</div>
        <div className="text-xs text-gray-500 break-all">{remote.url}</div>
      </td>
      <td className="px-2 py-2">
        <div>{state}</div>
        <div className="text-xs text-gray-500">
          {fetchedAgo(remote.lastFetch)}
        </div>
        {conflicts && (
          <div className="text-xs text-red-600 dark:text-red-400">
            would conflict: {conflicts.join(', ')}
          </div>
        )}
        {problem && (
          <div className="text-xs text-red-600 dark:text-red-400 break-words">
            {problem}
          </div>
        )}
      </td>
      <td className="px-2 py-2">
        <label className="inline-flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={remote.included}
            onChange={(e) => onInclude(e.target.checked)}
          />
          include
        </label>
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-wrap gap-1 justify-end">
          {OPERATIONS.map(({ operation, label, title }) => {
            const create = operation === 'push' && !remote.hasBranch;
            const needsBranch = operation !== 'fetch';
            return (
              <button
                key={operation}
                type="button"
                className={BUTTON}
                title={create ? `Create ${branch} on ${remote.name}` : title}
                disabled={
                  disabled ||
                  (needsBranch && !branch) ||
                  (operation === 'pull' && !remote.hasBranch)
                }
                onClick={() => onRun(operation)}
              >
                {busyOperation === operation
                  ? `${label}\u2026`
                  : create
                    ? 'Push to create'
                    : label}
              </button>
            );
          })}
        </div>
      </td>
    </tr>
  );
}
