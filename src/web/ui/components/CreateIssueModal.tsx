import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Priority, Status } from '../../../core/types.ts';
import { createIssue, uploadAsset } from '../api.ts';
import { useConfig } from '../hooks.ts';
import { Dropdown } from './Dropdown.tsx';
import { IssueEditor } from './IssueEditor.tsx';
import { LabelBadge } from './LabelBadge.tsx';
import { LabelPicker } from './LabelPicker.tsx';
import { PriorityBadge } from './PriorityBadge.tsx';
import { StatusBadge } from './StatusBadge.tsx';

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];
const STATUSES: Status[] = [
  'backlog',
  'todo',
  'in_progress',
  'done',
  'cancelled',
];

const STATUS_LABELS: Record<Status, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export function CreateIssueModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { config } = useConfig();
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<Status>(
    config?.defaultStatus ?? 'backlog',
  );
  const [priority, setPriority] = useState<Priority>('none');
  const [assignee, setAssignee] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<{
    insertImage: (url: string, alt: string) => void;
  } | null>(null);

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
        status,
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

  function handleToggleLabel(label: string) {
    setLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
  }

  function handleCreateLabel(label: string) {
    if (!labels.includes(label)) {
      setLabels((prev) => [...prev, label]);
    }
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) {
      onClose();
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await uploadAsset(file);
      editorRef.current?.insertImage(result.url, file.name);
    } catch {
      // Silently ignore upload failures for now
    }
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }

  const labelsTrigger =
    labels.length === 0 ? (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors">
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"
          />
        </svg>
        Label
      </span>
    ) : labels.length === 1 ? (
      <LabelBadge
        label={labels[0] as string}
        color={config?.labels[labels[0] as string]}
      />
    ) : (
      <span className="group relative inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 cursor-pointer">
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"
          />
        </svg>
        {labels.length} labels
        {/* Hover tooltip showing all labels */}
        <span className="absolute bottom-full left-0 mb-1 hidden group-hover:flex flex-wrap gap-1 p-1.5 rounded-lg bg-gray-900 dark:bg-gray-700 shadow-lg min-w-max">
          {labels.map((l) => (
            <LabelBadge key={l} label={l} color={config?.labels[l]} />
          ))}
        </span>
      </span>
    );

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
      <div className="w-full max-w-2xl rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl">
        {/* Close button */}
        <div className="flex justify-end px-4 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-5">
          {error && (
            <div className="text-red-400 text-sm mb-4">Error: {error}</div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Title — borderless */}
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Issue title"
              className="w-full bg-transparent text-lg font-semibold outline-none placeholder:text-gray-400 dark:placeholder:text-gray-600 mb-2"
              required
            />

            {/* Description — borderless editor */}
            <div className="mb-4 min-h-[100px]">
              <IssueEditor
                content=""
                onChange={setDescription}
                placeholder="Add description..."
                borderless
                ref={editorRef}
              />
            </div>

            {/* Bottom bar: pills + submit */}
            <div className="flex items-center justify-between gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-1 flex-wrap">
                {/* Status pill */}
                <Dropdown
                  value={status}
                  options={STATUSES}
                  labels={STATUS_LABELS}
                  onChange={setStatus}
                >
                  <StatusBadge status={status} onClick={() => {}} />
                </Dropdown>

                {/* Priority pill */}
                <Dropdown
                  value={priority}
                  options={PRIORITIES}
                  onChange={setPriority}
                >
                  <PriorityBadge priority={priority} onClick={() => {}} />
                </Dropdown>

                {/* Assignee pill */}
                <AssigneePill assignee={assignee} onChange={setAssignee} />

                {/* Labels pill */}
                <LabelPicker
                  selectedLabels={labels}
                  availableLabels={config?.labels ?? {}}
                  onToggleLabel={handleToggleLabel}
                  onCreateLabel={handleCreateLabel}
                  trigger={labelsTrigger}
                />

                {/* Attachment button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors"
                  title="Attach file"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                    />
                  </svg>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting || !title.trim()}
                className="px-5 py-1.5 text-sm rounded-full bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50 transition-colors"
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

/** Inline assignee pill — click to type, blur or Enter to confirm */
function AssigneePill({
  assignee,
  onChange,
}: {
  assignee: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(assignee);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(assignee);
  }, [assignee]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    onChange(value.trim());
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setValue(assignee);
            setEditing(false);
          }
        }}
        placeholder="Assignee"
        className="w-24 bg-transparent border border-gray-300 dark:border-gray-600 rounded-full px-2 py-0.5 text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-blue-500"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors"
    >
      <svg
        className="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
      </svg>
      {assignee || 'Assignee'}
    </button>
  );
}
