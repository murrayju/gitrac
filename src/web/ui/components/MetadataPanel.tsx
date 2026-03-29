import { useEffect, useRef, useState } from 'react';
import type { Issue, Priority, Status } from '../../../core/types.ts';
import { updateIssue } from '../api.ts';
import { useConfig } from '../hooks.ts';
import { Dropdown } from './Dropdown.tsx';
import { LabelBadge } from './LabelBadge.tsx';
import { LabelPicker } from './LabelPicker.tsx';
import { PriorityBadge } from './PriorityBadge.tsx';
import { StatusBadge } from './StatusBadge.tsx';

const STATUS_LABELS: Record<Status, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'None',
};

const STATUSES: Status[] = [
  'backlog',
  'todo',
  'in_progress',
  'done',
  'cancelled',
];
const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];

export function MetadataPanel({ issue }: { issue: Issue }) {
  const { config } = useConfig();
  const [assignee, setAssignee] = useState(issue.assignee);
  const [editingAssignee, setEditingAssignee] = useState(false);
  const assigneeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingAssignee && assigneeRef.current) {
      assigneeRef.current.focus();
    }
  }, [editingAssignee]);

  async function handleStatusChange(status: Status) {
    await updateIssue(issue.id, { status });
  }

  async function handlePriorityChange(priority: Priority) {
    await updateIssue(issue.id, { priority });
  }

  async function handleAssigneeSave() {
    setEditingAssignee(false);
    if (assignee !== issue.assignee) {
      await updateIssue(issue.id, { assignee });
    }
  }

  async function handleToggleLabel(label: string) {
    const newLabels = issue.labels.includes(label)
      ? issue.labels.filter((l) => l !== label)
      : [...issue.labels, label];
    await updateIssue(issue.id, { labels: newLabels });
  }

  async function handleCreateLabel(label: string) {
    if (!issue.labels.includes(label)) {
      await updateIssue(issue.id, { labels: [...issue.labels, label] });
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">
          Status
        </div>
        <Dropdown
          value={issue.status}
          options={STATUSES}
          labels={STATUS_LABELS}
          onChange={handleStatusChange}
        >
          <StatusBadge status={issue.status} onClick={() => {}} />
        </Dropdown>
      </div>

      <div>
        <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">
          Priority
        </div>
        <Dropdown
          value={issue.priority}
          options={PRIORITIES}
          labels={PRIORITY_LABELS}
          onChange={handlePriorityChange}
        >
          <PriorityBadge priority={issue.priority} onClick={() => {}} />
        </Dropdown>
      </div>

      <div>
        <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">
          Assignee
        </div>
        {editingAssignee ? (
          <input
            ref={assigneeRef}
            type="text"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            onBlur={handleAssigneeSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAssigneeSave();
            }}
            className="bg-white border border-gray-300 rounded px-2 py-1 text-sm text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 w-full"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingAssignee(true)}
            className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
          >
            {issue.assignee || 'Unassigned'}
          </button>
        )}
      </div>

      <div>
        <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">
          Labels
        </div>
        <div className="flex flex-wrap gap-1 mb-2">
          {issue.labels.map((label) => (
            <LabelBadge
              key={label}
              label={label}
              color={config?.labels[label]}
              onRemove={() => handleToggleLabel(label)}
            />
          ))}
        </div>
        <LabelPicker
          selectedLabels={issue.labels}
          availableLabels={config?.labels ?? {}}
          onToggleLabel={handleToggleLabel}
          onCreateLabel={handleCreateLabel}
          trigger={
            <span className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer">
              + Add label
            </span>
          }
        />
      </div>
    </div>
  );
}
