import { useNavigate } from 'react-router-dom';
import type { Issue, Priority, Status } from '../../../core/types.ts';
import { updateIssue } from '../api.ts';
import { relativeTime } from '../lib/time.ts';
import { Dropdown } from './Dropdown.tsx';
import { PriorityBadge } from './PriorityBadge.tsx';
import { StatusBadge } from './StatusBadge.tsx';

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

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];
const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'None',
};

export function IssueRow({ issue }: { issue: Issue }) {
  const navigate = useNavigate();

  async function handleStatusChange(status: Status) {
    await updateIssue(issue.id, { status });
  }

  async function handlePriorityChange(priority: Priority) {
    await updateIssue(issue.id, { priority });
  }

  return (
    <tr
      className="border-b border-gray-800/50 hover:bg-gray-900/50 cursor-pointer transition-colors"
      onClick={() => navigate(`/issues/${issue.id}`)}
    >
      <td className="px-3 py-2 text-sm text-gray-500 w-16">#{issue.id}</td>
      <td className="px-3 py-2 text-sm font-medium truncate max-w-md">
        {issue.title}
      </td>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation for dropdown interaction within clickable row */}
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <Dropdown
          value={issue.status}
          options={STATUSES}
          labels={STATUS_LABELS}
          onChange={handleStatusChange}
        >
          <StatusBadge status={issue.status} onClick={() => {}} />
        </Dropdown>
      </td>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation for dropdown interaction within clickable row */}
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <Dropdown
          value={issue.priority}
          options={PRIORITIES}
          labels={PRIORITY_LABELS}
          onChange={handlePriorityChange}
        >
          <PriorityBadge priority={issue.priority} onClick={() => {}} />
        </Dropdown>
      </td>
      <td className="px-3 py-2 text-sm text-gray-400">
        {issue.assignee || '—'}
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1 flex-wrap">
          {issue.labels.map((label) => (
            <span
              key={label}
              className="px-1.5 py-0.5 rounded text-xs bg-gray-800 text-gray-400"
            >
              {label}
            </span>
          ))}
        </div>
      </td>
      <td
        className="px-3 py-2 text-sm text-gray-500"
        title={new Date(issue.updated).toLocaleString()}
      >
        {relativeTime(issue.updated)}
      </td>
    </tr>
  );
}
