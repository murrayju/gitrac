import { Link } from 'react-router-dom';
import type { CommitList } from '../../../core/sync.ts';
import {
  canSync,
  type IndicatorTone,
  indicator,
  outcomeText,
  syncBanner,
  tooltipSections,
} from '../lib/sync.ts';
import { useSync } from '../sync-hooks.ts';

const TONE_CLASS: Record<IndicatorTone, string> = {
  ok: 'text-green-600 dark:text-green-400',
  pending: 'text-amber-600 dark:text-amber-400',
  warning: 'text-orange-600 dark:text-orange-400',
  error: 'text-red-600 dark:text-red-400 font-semibold',
  muted: 'text-gray-500',
};

const DOT_CLASS: Record<IndicatorTone, string> = {
  ok: 'bg-green-500',
  pending: 'bg-amber-500',
  warning: 'bg-orange-500',
  error: 'bg-red-500 animate-pulse',
  muted: 'bg-gray-400',
};

/**
 * Compact sync indicator for the sidebar footer: the state (`in sync`,
 * `↑2 ↓1`, `not synced`, `sync conflict`), a tooltip with the commits to
 * push and pull per remote, a Sync button and a link to the remotes view.
 */
export function SyncStatus({ onNavigate }: { onNavigate?: () => void }) {
  const {
    status,
    problems,
    busy,
    fetching,
    lastResult,
    requestError,
    actions,
  } = useSync();
  const shown = indicator(status, problems);
  const sections = status ? tooltipSections(status, problems) : [];
  const syncing = busy?.operation === 'sync' && busy.remote === undefined;
  const failed = lastResult?.remotes.filter((r) => r.error) ?? [];

  return (
    <div className="text-xs" data-testid="sync-status">
      <div className="flex items-center gap-2">
        {/* Hover or focus shows the commits that a sync moves. */}
        <div className="group relative min-w-0 flex-1">
          <button
            type="button"
            className={`flex items-center gap-1.5 truncate ${TONE_CLASS[shown.tone]}`}
            // Manual refresh: fetch the included remotes now.
            onClick={() => void actions.backgroundFetch()}
            aria-describedby="sync-tooltip"
          >
            <span
              className={`inline-block w-2 h-2 shrink-0 rounded-full ${DOT_CLASS[shown.tone]}`}
            />
            <span className="truncate">{shown.label}</span>
            {fetching && <span className="text-gray-400">{'\u2026'}</span>}
          </button>
          {status && (
            <div
              id="sync-tooltip"
              role="tooltip"
              className="hidden group-hover:block group-focus-within:block absolute bottom-full left-0 z-50 mb-2 w-80 max-h-96 overflow-auto rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-900"
            >
              {sections.length === 0 ? (
                <div className="text-gray-500">
                  {status.remotes.length === 0
                    ? 'This repository has no remotes.'
                    : 'No remote is included in sync.'}
                </div>
              ) : (
                sections.map((s) => (
                  <div key={s.remote} className="mb-2 last:mb-0">
                    <div className="font-medium text-gray-700 dark:text-gray-200">
                      {s.remote}: {s.heading}
                    </div>
                    <Commits title="To push" list={s.toPush} />
                    <Commits title="To pull" list={s.toPull} />
                    {s.note && (
                      <div className="mt-1 text-red-600 dark:text-red-400 break-words">
                        {s.note}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void actions.run('sync')}
          disabled={!canSync(status) || busy !== null}
          className="shrink-0 rounded border border-gray-300 dark:border-gray-700 px-2 py-0.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          title="Fetch, merge and push the included remotes"
        >
          {syncing ? 'Syncing\u2026' : 'Sync'}
        </button>
      </div>
      {(requestError || failed.length > 0) && (
        <div
          role="alert"
          className="mt-1 text-red-600 dark:text-red-400 break-words"
        >
          {requestError ??
            failed.map((r) => <div key={r.remote}>{outcomeText(r)}</div>)}
          <button
            type="button"
            onClick={actions.dismiss}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Dismiss
          </button>
        </div>
      )}
      <Link
        to="/remotes"
        onClick={onNavigate}
        className="mt-1 inline-block text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
      >
        Remotes
      </Link>
    </div>
  );
}

function Commits({ title, list }: { title: string; list: CommitList }) {
  if (list.commits.length === 0) return null;
  return (
    <div className="mt-1">
      <div className="text-gray-500">{title}</div>
      <ul className="font-mono">
        {list.commits.map((c) => (
          <li
            key={c.hash}
            className="truncate"
            title={`${c.subject} (${c.author})`}
          >
            <span className="text-gray-400">{c.hash}</span>{' '}
            <span className="text-gray-700 dark:text-gray-300">
              {c.subject}
            </span>
          </li>
        ))}
        {list.more > 0 && <li className="text-gray-500">+{list.more} more</li>}
      </ul>
    </div>
  );
}

/**
 * Red banner over the main content while sync needs the terminal: a merge
 * or rebase in progress, a conflict, or local changes in the way. It stays
 * until the status shows that the problem is resolved.
 */
export function SyncBanner() {
  const { status, problems } = useSync();
  const banner = syncBanner(status, problems);
  if (!banner) return null;
  return (
    <div
      role="alert"
      className="bg-red-700 border-b border-red-900 px-4 py-2 text-sm text-white"
      data-testid="sync-banner"
    >
      <div className="font-semibold">{banner.title}</div>
      <div className="mt-0.5">{banner.message}</div>
      {banner.commands.length > 0 && (
        <>
          <div className="mt-1 text-red-100">Run in a terminal:</div>
          <pre className="mt-0.5 overflow-x-auto rounded bg-red-950/60 px-2 py-1 text-xs">
            {banner.commands.join('\n')}
          </pre>
        </>
      )}
    </div>
  );
}
