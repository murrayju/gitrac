import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Priority } from '../../../core/types.ts';
import { createIssue } from '../api.ts';
import { useConfig } from '../hooks.ts';
import { IssueEditor } from './IssueEditor.tsx';

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];

export function CreateIssueModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { config } = useConfig();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('none');
  const [assignee, setAssignee] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Focus title input on mount
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Handle Escape key to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const issue = await createIssue({
        title: title.trim(),
        priority,
        labels,
        assignee: assignee.trim() || undefined,
        description,
      });
      onClose();
      navigate(`/issues/${issue.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create issue');
    } finally {
      setSubmitting(false);
    }
  }

  function addLabel() {
    const trimmed = labelInput.trim();
    if (!trimmed || labels.includes(trimmed)) return;
    setLabels([...labels, trimmed]);
    setLabelInput('');
  }

  function removeLabel(label: string) {
    setLabels(labels.filter((l) => l !== label));
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) {
      onClose();
    }
  }

  const availableLabels = config?.labels.filter((l) => !labels.includes(l));

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape key handled via document listener
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-label="Create new issue"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-12 px-4"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-2xl rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold">New Issue</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xl leading-none px-1"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {error && (
            <div className="text-red-400 text-sm mb-4">Error: {error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Title */}
            <div>
              <input
                ref={titleRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Issue title"
                className="w-full bg-transparent text-lg font-medium border-b border-gray-300 dark:border-gray-700 focus:border-blue-500 outline-none pb-2 placeholder:text-gray-400 dark:placeholder:text-gray-600"
                required
              />
            </div>

            {/* Priority & Assignee */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label
                  htmlFor="create-priority"
                  className="block text-xs text-gray-500 uppercase tracking-wider mb-1"
                >
                  Priority
                </label>
                <select
                  id="create-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  className="bg-white border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 w-full"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex-1">
                <label
                  htmlFor="create-assignee"
                  className="block text-xs text-gray-500 uppercase tracking-wider mb-1"
                >
                  Assignee
                </label>
                <input
                  id="create-assignee"
                  type="text"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  placeholder="Unassigned"
                  className="bg-white border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-700 placeholder:text-gray-400 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 dark:placeholder:text-gray-600 w-full"
                />
              </div>
            </div>

            {/* Labels */}
            <div>
              <label
                htmlFor="create-label-input"
                className="block text-xs text-gray-500 uppercase tracking-wider mb-1"
              >
                Labels
              </label>
              <div className="flex flex-wrap gap-1 mb-2">
                {labels.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    {label}
                    <button
                      type="button"
                      onClick={() => removeLabel(label)}
                      className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1">
                <input
                  id="create-label-input"
                  type="text"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addLabel();
                    }
                  }}
                  placeholder="Add label..."
                  list="create-available-labels"
                  className="bg-white border border-gray-300 rounded px-2 py-1 text-xs text-gray-700 placeholder:text-gray-400 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 dark:placeholder:text-gray-600 flex-1"
                />
                <datalist id="create-available-labels">
                  {availableLabels?.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
                <button
                  type="button"
                  onClick={addLabel}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2"
                >
                  +
                </button>
              </div>
            </div>

            {/* Description */}
            <div>
              <span className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
                Description
              </span>
              <IssueEditor content="" onChange={setDescription} />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:border-gray-500 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !title.trim()}
                className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Creating...' : 'Create Issue'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
