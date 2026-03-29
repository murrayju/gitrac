import { useMemo, useState } from 'react';
import type { Issue, Priority, Status } from '../../../core/types.ts';
import type { IssueFilters } from '../api.ts';
import { useIssues } from '../hooks.ts';
import { IssueRow } from './IssueRow.tsx';

type SortField =
  | 'id'
  | 'title'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'updated';
type SortDir = 'asc' | 'desc';

const PRIORITY_ORDER: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

const STATUS_ORDER: Record<Status, number> = {
  in_progress: 0,
  todo: 1,
  backlog: 2,
  done: 3,
  cancelled: 4,
};

export function IssueList() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('updated');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const filters: IssueFilters = {};
  if (statusFilter) filters.status = statusFilter;
  if (priorityFilter) filters.priority = priorityFilter;
  if (assigneeFilter) filters.assignee = assigneeFilter;

  const { issues, loading, error } = useIssues(filters);

  const sorted = useMemo(() => {
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
          cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
          break;
        case 'priority':
          cmp =
            (PRIORITY_ORDER[a.priority] ?? 99) -
            (PRIORITY_ORDER[b.priority] ?? 99);
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
  }, [issues, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
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

        <div className="flex gap-2">
          <FilterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            placeholder="Status"
            options={[
              { value: '', label: 'All statuses' },
              { value: 'backlog', label: 'Backlog' },
              { value: 'todo', label: 'Todo' },
              { value: 'in_progress', label: 'In Progress' },
              { value: 'done', label: 'Done' },
              { value: 'cancelled', label: 'Cancelled' },
              { value: 'all', label: 'All (incl. closed)' },
            ]}
          />
          <FilterSelect
            value={priorityFilter}
            onChange={setPriorityFilter}
            placeholder="Priority"
            options={[
              { value: '', label: 'All priorities' },
              { value: 'urgent', label: 'Urgent' },
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
              { value: 'none', label: 'None' },
            ]}
          />
          <input
            type="text"
            placeholder="Assignee..."
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-300 placeholder:text-gray-600 w-32"
          />
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
              <tr className="border-b border-gray-800 text-left">
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
      className={`px-3 py-2 text-xs font-medium uppercase tracking-wider cursor-pointer select-none hover:text-gray-300 ${
        field === current ? 'text-gray-300' : 'text-gray-500'
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
      className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-300"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
