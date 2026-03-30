import type { Draft } from '../api.ts';
import { deleteDraft } from '../api.ts';
import { useDrafts } from '../hooks.ts';
import { relativeTime } from '../lib/time.ts';
import { useLayout } from './Layout.tsx';
import { PriorityBadge } from './PriorityBadge.tsx';

export function DraftList() {
  const { drafts, loading, refresh } = useDrafts();
  const { openCreateModal, refreshDrafts } = useLayout();

  function handleOpenDraft(draft: Draft) {
    openCreateModal(draft);
  }

  async function handleDelete(e: React.MouseEvent, filename: string) {
    e.stopPropagation();
    try {
      await deleteDraft(filename);
      refresh();
      refreshDrafts();
    } catch {
      // ignore
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Drafts</h1>
      </div>

      {loading && drafts.length === 0 ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : drafts.length === 0 ? (
        <div className="text-gray-500 text-sm">No drafts found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-left">
                <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Title
                </th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Priority
                </th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Saved
                </th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider w-16" />
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => (
                <tr
                  key={draft.filename}
                  className="border-b border-gray-200/50 dark:border-gray-800/50 hover:bg-gray-100/50 dark:hover:bg-gray-900/50 cursor-pointer transition-colors"
                  onClick={() => handleOpenDraft(draft)}
                >
                  <td className="px-3 py-2 text-sm font-medium truncate max-w-md">
                    {draft.title.trim() || (
                      <span className="text-gray-400 italic">Untitled</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <PriorityBadge
                      priority={
                        (draft.priority as
                          | 'urgent'
                          | 'high'
                          | 'medium'
                          | 'low'
                          | 'none') || 'none'
                      }
                    />
                  </td>
                  <td
                    className="px-3 py-2 text-sm text-gray-500"
                    title={
                      draft.savedAt
                        ? new Date(draft.savedAt).toLocaleString()
                        : ''
                    }
                  >
                    {draft.savedAt ? relativeTime(draft.savedAt) : '\u2014'}
                  </td>
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation for delete button within clickable row */}
                  <td
                    className="px-3 py-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, draft.filename)}
                      className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      title="Delete draft"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
