import { useEffect, useMemo, useState } from 'react';
import type { Issue } from '../../../core/types.ts';
import { statusSortOrder } from '../../../core/workflow.ts';
import { useConfig, useIssues, useWorkflow } from '../hooks.ts';
import { labelFilterOptions, listFilters } from '../lib/list-filters.ts';
import type { SortField } from '../stores/filterStore.ts';
import { useFilterStore } from '../stores/filterStore.ts';
import { IssueRow } from './IssueRow.tsx';

export function IssueList() {
  const { config } = useConfig();
  const workflow = useWorkflow();
  const statusFilter = useFilterStore((s) => s.statusFilter);
  const setStatusFilter = useFilterStore((s) => s.setStatusFilter);
  const priorityFilter = useFilterStore((s) => s.priorityFilter);
  const setPriorityFilter = useFilterStore((s) => s.setPriorityFilter);
  const assigneeFilter = useFilterStore((s) => s.assigneeFilter);
  const setAssigneeFilter = useFilterStore((s) => s.setAssigneeFilter);
  const labelFilter = useFilterStore((s) => s.labelFilter);
  const setLabelFilter = useFilterStore((s) => s.setLabelFilter);
  const searchText = useFilterStore((s) => s.searchText);
  const setSearchText = useFilterStore((s) => s.setSearchText);
  const mineFilter = useFilterStore((s) => s.mineFilter);
  const setMineFilter = useFilterStore((s) => s.setMineFilter);
  const sortField = useFilterStore((s) => s.sortField);
  const setSortField = useFilterStore((s) => s.setSortField);
  const sortDir = useFilterStore((s) => s.sortDir);
  const setSortDir = useFilterStore((s) => s.setSortDir);

  const search = useDebounced(searchText, SEARCH_DEBOUNCE_MS);
  const filters = listFilters({
    statusFilter,
    priorityFilter,
    assigneeFilter,
    labelFilter,
    search,
    mineFilter,
  });

  const { issues, loading, error } = useIssues(filters);

  const sorted = useMemo(() => {
    // Same orders as `gitrac ls --sort status|priority` (src/core/query.ts).
    const statusOrder = statusSortOrder(workflow.source);
    const rank = (order: string[], value: string) => {
      const i = order.indexOf(value);
      return i === -1 ? order.length : i;
    };
    const list = [...issues];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'id':
          cmp = a.id - b.id;
          break;
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'status':
          cmp = rank(statusOrder, a.status) - rank(statusOrder, b.status);
          break;
        case 'priority':
          cmp =
            rank(workflow.priorities, a.priority) -
            rank(workflow.priorities, b.priority);
          break;
        case 'assignee':
          cmp = a.assignee.localeCompare(b.assignee);
          break;
        case 'updated':
          cmp = new Date(a.updated).getTime() - new Date(b.updated).getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [issues, sortField, sortDir, workflow]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function sortIndicator(field: SortField) {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Issues</h1>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <input
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search"
            aria-label="Search title and description"
            title="Every word must appear in the title or description"
            className="w-44 bg-white border border-gray-300 rounded px-2 py-1 text-sm text-gray-700 placeholder-gray-400 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 dark:placeholder-gray-600"
          />
          <FilterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            placeholder="Status"
            options={[
              { value: '', label: 'Open' },
              ...workflow.statuses.map((s) => ({
                value: s,
                label: workflow.statusLabels[s] ?? s,
              })),
              { value: 'all', label: 'All' },
            ]}
          />
          <FilterSelect
            value={priorityFilter}
            onChange={setPriorityFilter}
            placeholder="Priority"
            options={[
              { value: '', label: 'All priorities' },
              ...workflow.priorities.map((p) => ({
                value: p,
                label: workflow.priorityLabels[p] ?? p,
              })),
            ]}
          />
          <FilterSelect
            value={assigneeFilter}
            onChange={setAssigneeFilter}
            placeholder="Assignee"
            options={[
              { value: '', label: 'All assignees' },
              ...(config?.assignees ?? []).map((a) => ({
                value: a.email,
                label: a.name,
              })),
            ]}
          />
          <FilterSelect
            value={labelFilter}
            onChange={setLabelFilter}
            placeholder="Label"
            options={[
              { value: '', label: 'All labels' },
              ...labelFilterOptions(config?.labels, labelFilter).map((l) => ({
                value: l,
                label: l,
              })),
            ]}
          />
          <label
            className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none"
            title="Only issues assigned to the server's git identity (not the identity picked in the UI)"
          >
            <input
              type="checkbox"
              checked={mineFilter}
              onChange={(e) => setMineFilter(e.target.checked)}
            />
            Mine
          </label>
        </div>
      </div>

      {error && <div className="text-red-400 text-sm mb-4">Error: {error}</div>}

      {loading && issues.length === 0 ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : issues.length === 0 ? (
        <div className="text-gray-500 text-sm">No issues found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-left">
                <SortHeader field="id" current={sortField} onSort={handleSort}>
                  ID{sortIndicator('id')}
                </SortHeader>
                <SortHeader
                  field="title"
                  current={sortField}
                  onSort={handleSort}
                >
                  Title{sortIndicator('title')}
                </SortHeader>
                <SortHeader
                  field="status"
                  current={sortField}
                  onSort={handleSort}
                >
                  Status{sortIndicator('status')}
                </SortHeader>
                <SortHeader
                  field="priority"
                  current={sortField}
                  onSort={handleSort}
                >
                  Priority{sortIndicator('priority')}
                </SortHeader>
                <SortHeader
                  field="assignee"
                  current={sortField}
                  onSort={handleSort}
                >
                  Assignee{sortIndicator('assignee')}
                </SortHeader>
                <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Labels
                </th>
                <SortHeader
                  field="updated"
                  current={sortField}
                  onSort={handleSort}
                >
                  Updated{sortIndicator('updated')}
                </SortHeader>
              </tr>
            </thead>
            <tbody>
              {sorted.map((issue: Issue) => (
                <IssueRow key={issue.id} issue={issue} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Wait this long after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 250;

/** `value`, updated only once it has stayed the same for `delayMs`. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function SortHeader({
  field,
  current,
  onSort,
  children,
}: {
  field: SortField;
  current: SortField;
  onSort: (field: SortField) => void;
  children: React.ReactNode;
}) {
  return (
    <th
      className={`px-3 py-2 text-xs font-medium uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 ${
        field === current ? 'text-gray-700 dark:text-gray-300' : 'text-gray-500'
      }`}
      onClick={() => onSort(field)}
    >
      {children}
    </th>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder: _placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-white border border-gray-300 rounded px-2 py-1 text-sm text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
