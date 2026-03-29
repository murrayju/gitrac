import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

interface LabelPickerProps {
  selectedLabels: string[];
  availableLabels: Record<string, string>; // label name -> hex color
  onToggleLabel: (label: string) => void;
  onCreateLabel?: (label: string) => void;
  trigger: ReactNode;
}

export function LabelPicker({
  selectedLabels,
  availableLabels,
  onToggleLabel,
  onCreateLabel,
  trigger,
}: LabelPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevFilterRef = useRef(filter);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
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
      // Defer focus to next frame so popover has mounted
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

  const allLabelNames = useMemo(
    () => Object.keys(availableLabels),
    [availableLabels],
  );

  const filtered = useMemo(() => {
    if (!filter) return allLabelNames;
    const lower = filter.toLowerCase();
    return allLabelNames.filter((l) => l.toLowerCase().includes(lower));
  }, [allLabelNames, filter]);

  // Determine if we should show a "create" option
  const trimmedFilter = filter.trim();
  const exactMatch = allLabelNames.some(
    (l) => l.toLowerCase() === trimmedFilter.toLowerCase(),
  );
  const showCreate = !!onCreateLabel && !!trimmedFilter && !exactMatch;

  // Total items: filtered labels + optional create option
  const totalItems = filtered.length + (showCreate ? 1 : 0);

  function handleToggle(label: string) {
    onToggleLabel(label);
  }

  function handleCreate() {
    if (onCreateLabel && trimmedFilter) {
      onCreateLabel(trimmedFilter);
      setFilter('');
    }
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
      if (highlightIndex < filtered.length) {
        handleToggle(filtered[highlightIndex] as string);
      } else if (showCreate && highlightIndex === filtered.length) {
        handleCreate();
      }
      return;
    }
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
              placeholder="Filter labels..."
              className="w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-600 outline-none focus:border-blue-500"
            />
          </div>

          {/* Label list */}
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.map((label, index) => {
              const isSelected = selectedLabels.includes(label);
              const isHighlighted = index === highlightIndex;
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: onMouseEnter for highlight tracking, keyboard nav via input
                <div
                  key={label}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${
                    isHighlighted
                      ? 'bg-gray-100 dark:bg-gray-800'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  onMouseEnter={() => setHighlightIndex(index)}
                >
                  {/* Checkbox area — toggles without closing */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggle(label);
                    }}
                    className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center text-xs ${
                      isSelected
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'border-gray-300 dark:border-gray-600 bg-transparent'
                    }`}
                    tabIndex={-1}
                  >
                    {isSelected && '✓'}
                  </button>
                  {/* Color dot */}
                  <span
                    className="flex-shrink-0 w-3 h-3 rounded-full"
                    style={{
                      backgroundColor: availableLabels[label] || '#6b7280',
                    }}
                  />
                  {/* Label name — toggles AND closes */}
                  <button
                    type="button"
                    onClick={() => {
                      handleToggle(label);
                      setOpen(false);
                    }}
                    className="flex-1 text-left text-gray-700 dark:text-gray-300 bg-transparent border-none p-0 cursor-pointer"
                    tabIndex={-1}
                  >
                    {label}
                  </button>
                </div>
              );
            })}

            {/* Create option */}
            {showCreate && (
              <button
                type="button"
                onClick={() => {
                  handleCreate();
                }}
                onMouseEnter={() => setHighlightIndex(filtered.length)}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer w-full text-left bg-transparent border-none ${
                  highlightIndex === filtered.length
                    ? 'bg-gray-100 dark:bg-gray-800'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                tabIndex={-1}
              >
                <span className="flex-shrink-0 w-4 h-4" />
                <span className="text-blue-600 dark:text-blue-400">
                  Create "{trimmedFilter}"
                </span>
              </button>
            )}

            {/* Empty state */}
            {filtered.length === 0 && !showCreate && (
              <div className="px-3 py-2 text-sm text-gray-400">
                No labels found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
