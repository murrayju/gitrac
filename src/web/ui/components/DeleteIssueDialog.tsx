import { useEffect, useRef } from 'react';
import type { IssueDeletion } from '../api.ts';

type UnlinkedIssue = IssueDeletion['unlinked'][number];

/** Which links of an unlinked issue go: `blockedBy`, `parent`, or both. */
function removedLinks(u: UnlinkedIssue): string {
  return [u.blockedBy && 'blocked by', u.parent && 'parent']
    .filter(Boolean)
    .join(', ');
}

/**
 * Confirmation for deleting an issue, listing what the server's dry run
 * (`DELETE /api/issues/:id?dryRun=1`) says will go: the issue file, the
 * assets only it uses, and the other issues whose links to it are removed.
 */
export function DeleteIssueDialog({
  plan,
  deleting,
  onConfirm,
  onCancel,
}: {
  plan: IssueDeletion;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { issue, paths, assets, unlinked } = plan;
  const issueFile = paths[0];

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !deleting) {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, deleting]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current && !deleting) onCancel();
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape key handled via document listener
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-issue-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl">
        <div className="px-5 pt-4 pb-3 border-b border-gray-200 dark:border-gray-800">
          <h2
            id="delete-issue-title"
            className="text-sm font-semibold text-gray-900 dark:text-gray-100"
          >
            Delete issue #{issue.id} “{issue.title}”?
          </h2>
        </div>

        <div className="px-5 py-4 space-y-4 text-sm text-gray-700 dark:text-gray-300 max-h-[60vh] overflow-y-auto">
          <p>This commits the following changes:</p>

          <section>
            <h3 className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
              Deleted
            </h3>
            <ul className="space-y-0.5 font-mono text-xs">
              {issueFile && <li>{issueFile}</li>}
              {assets.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            {assets.length === 0 && (
              <p className="mt-1 text-xs text-gray-500">
                No images are only used by this issue.
              </p>
            )}
          </section>

          <section>
            <h3 className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
              Links removed from
            </h3>
            {unlinked.length === 0 ? (
              <p className="text-xs text-gray-500">
                No other issues link to #{issue.id}.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {unlinked.map((u) => (
                  <li key={u.id}>
                    <span className="text-gray-500">#{u.id}</span> {u.title}{' '}
                    <span className="text-xs text-gray-500">
                      ({removedLinks(u)})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-800">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete issue'}
          </button>
        </div>
      </div>
    </div>
  );
}
