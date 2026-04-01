import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Assignee } from '../../../core/types.ts';
import { updateAssignees } from '../api.ts';
import { useConfig } from '../hooks.ts';

interface AssigneePickerProps {
  value: string; // current assignee (email)
  onChange: (email: string) => void;
  trigger: ReactNode;
}

export function AssigneePicker({
  value,
  onChange,
  trigger,
}: AssigneePickerProps) {
  const { config } = useConfig();
  const assignees = config?.assignees ?? [];
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const prevFilterRef = useRef(filter);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Focus input when popover opens
  useEffect(() => {
    if (open) {
      setFilter('');
      setHighlightIndex(0);
      setCreating(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Reset highlight when filter text changes
  useEffect(() => {
    if (filter !== prevFilterRef.current) {
      setHighlightIndex(0);
      prevFilterRef.current = filter;
    }
  });

  // Focus name input when creating
  useEffect(() => {
    if (creating) {
      requestAnimationFrame(() => nameInputRef.current?.focus());
    }
  }, [creating]);

  const filtered = useMemo(() => {
    if (!filter) return assignees;
    const lower = filter.toLowerCase();
    return assignees.filter(
      (a) =>
        a.name.toLowerCase().includes(lower) ||
        a.email.toLowerCase().includes(lower),
    );
  }, [assignees, filter]);

  // Determine if we should show a "create" option
  const trimmedFilter = filter.trim();
  const exactMatch = assignees.some(
    (a) =>
      a.email.toLowerCase() === trimmedFilter.toLowerCase() ||
      a.name.toLowerCase() === trimmedFilter.toLowerCase(),
  );
  const showCreate = !!trimmedFilter && !exactMatch;

  // Include "Unassign" option if there is a current assignee
  const showUnassign = !!value;

  // Total items: unassign + filtered assignees + optional create
  const totalItems =
    (showUnassign ? 1 : 0) + filtered.length + (showCreate ? 1 : 0);

  function handleSelect(assignee: Assignee) {
    onChange(assignee.email);
    setOpen(false);
  }

  function handleUnassign() {
    onChange('');
    setOpen(false);
  }

  function startCreate() {
    // Pre-fill: if filter looks like email, put in email field; else put in name
    if (trimmedFilter.includes('@')) {
      setNewEmail(trimmedFilter);
      setNewName('');
    } else {
      setNewName(trimmedFilter);
      setNewEmail('');
    }
    setCreating(true);
  }

  async function handleCreate() {
    const name = newName.trim();
    const email = newEmail.trim();
    if (!name || !email) return;

    const newAssignee: Assignee = { name, email };
    const updated = [...assignees, newAssignee];
    try {
      await updateAssignees(updated);
    } catch {
      // ignore
    }
    onChange(email);
    setCreating(false);
    setOpen(false);
  }

  function getItemIndex(
    type: 'unassign' | 'assignee' | 'create',
    i?: number,
  ): number {
    if (type === 'unassign') return 0;
    const offset = showUnassign ? 1 : 0;
    if (type === 'assignee') return offset + (i ?? 0);
    return offset + filtered.length;
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, totalItems - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (totalItems === 0) return;
      const unassignIdx = showUnassign ? 0 : -1;
      const assigneeStart = showUnassign ? 1 : 0;
      if (highlightIndex === unassignIdx) {
        handleUnassign();
      } else if (highlightIndex < assigneeStart + filtered.length) {
        const assignee = filtered[highlightIndex - assigneeStart];
        if (assignee) handleSelect(assignee);
      } else if (showCreate) {
        startCreate();
      }
      return;
    }
  }

  if (creating) {
    return (
      <div ref={ref} className="relative inline-block">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="appearance-none bg-transparent border-none p-0 cursor-pointer"
        >
          {trigger}
        </button>
        <div className="absolute z-50 mt-1 min-w-56 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900 p-3">
          <div className="text-xs font-medium text-gray-500 mb-2">
            New assignee
          </div>
          <input
            ref={nameInputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            className="w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-600 outline-none focus:border-blue-500 mb-2"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') {
                setCreating(false);
                setOpen(false);
              }
            }}
          />
          <input
            type="text"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="Email"
            className="w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-600 outline-none focus:border-blue-500 mb-2"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') {
                setCreating(false);
                setOpen(false);
              }
            }}
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setOpen(false);
              }}
              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!newName.trim() || !newEmail.trim()}
              className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="appearance-none bg-transparent border-none p-0 cursor-pointer"
      >
        {trigger}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 min-w-48 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {/* Search input */}
          <div className="p-2 border-b border-gray-200 dark:border-gray-700">
            <input
              ref={inputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Filter assignees..."
              className="w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-600 outline-none focus:border-blue-500"
            />
          </div>

          {/* Assignee list */}
          <div className="max-h-56 overflow-y-auto py-1">
            {/* Unassign option */}
            {showUnassign && (
              <button
                type="button"
                onClick={handleUnassign}
                onMouseEnter={() => setHighlightIndex(getItemIndex('unassign'))}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer w-full text-left bg-transparent border-none ${
                  highlightIndex === getItemIndex('unassign')
                    ? 'bg-gray-100 dark:bg-gray-800'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                tabIndex={-1}
              >
                <span className="text-gray-400 italic">Unassign</span>
              </button>
            )}

            {filtered.map((assignee, index) => {
              const isSelected =
                value.toLowerCase() === assignee.email.toLowerCase();
              const itemIndex = getItemIndex('assignee', index);
              const isHighlighted = itemIndex === highlightIndex;
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: onMouseEnter for highlight tracking, keyboard nav via input
                <div
                  key={assignee.email}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${
                    isHighlighted
                      ? 'bg-gray-100 dark:bg-gray-800'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  onMouseEnter={() => setHighlightIndex(itemIndex)}
                >
                  <button
                    type="button"
                    onClick={() => handleSelect(assignee)}
                    className="flex-1 text-left bg-transparent border-none p-0 cursor-pointer"
                    tabIndex={-1}
                  >
                    <div className="flex items-center gap-2">
                      {/* Selection indicator */}
                      <span
                        className={`flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center text-xs ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'border-gray-300 dark:border-gray-600 bg-transparent'
                        }`}
                      >
                        {isSelected && '✓'}
                      </span>
                      <div>
                        <div className="text-gray-700 dark:text-gray-300">
                          {assignee.name}
                        </div>
                        <div className="text-xs text-gray-400">
                          {assignee.email}
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}

            {/* Create option */}
            {showCreate && (
              <button
                type="button"
                onClick={startCreate}
                onMouseEnter={() => setHighlightIndex(getItemIndex('create'))}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer w-full text-left bg-transparent border-none ${
                  highlightIndex === getItemIndex('create')
                    ? 'bg-gray-100 dark:bg-gray-800'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                tabIndex={-1}
              >
                <span className="flex-shrink-0 w-4 h-4" />
                <span className="text-blue-600 dark:text-blue-400">
                  Create assignee "{trimmedFilter}"
                </span>
              </button>
            )}

            {/* Empty state */}
            {filtered.length === 0 && !showCreate && (
              <div className="px-3 py-2 text-sm text-gray-400">
                No assignees found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
