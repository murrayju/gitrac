import { useEffect, useRef, useState } from 'react';
import type { Issue, Priority, Status } from '../../../core/types.ts';
import { updateIssue } from '../api.ts';
import { useConfig } from '../hooks.ts';
import { Dropdown } from './Dropdown.tsx';
import { LabelBadge } from './LabelBadge.tsx';
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
  const [labelInput, setLabelInput] = useState('');
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

  async function handleRemoveLabel(label: string) {
    const newLabels = issue.labels.filter((l) => l !== label);
    await updateIssue(issue.id, { labels: newLabels });
  }

  const availableLabels = config?.labels.filter(
    (l) => !issue.labels.includes(l),
  );

  async function handleAddLabel(value?: string) {
    const trimmed = (value ?? labelInput).trim();
    if (!trimmed || issue.labels.includes(trimmed)) return;
    setLabelInput('');
    await updateIssue(issue.id, { labels: [...issue.labels, trimmed] });
  }

  function handleLabelInputChange(value: string) {
    setLabelInput(value);
    // If the typed/selected value matches an available label, add it immediately
    const trimmed = value.trim();
    if (trimmed && availableLabels?.includes(trimmed)) {
      handleAddLabel(trimmed);
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
              color={config?.labelColors[label]}
              onRemove={() => handleRemoveLabel(label)}
            />
          ))}
        </div>
        <div className="flex gap-1">
          <input
            type="text"
            value={labelInput}
            onChange={(e) => handleLabelInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddLabel();
            }}
            placeholder="Add label..."
            list="available-labels"
            className="bg-white border border-gray-300 rounded px-2 py-1 text-xs text-gray-700 placeholder:text-gray-400 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 dark:placeholder:text-gray-600 flex-1"
          />
          <datalist id="available-labels">
            {availableLabels?.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>
      </div>
    </div>
  );
}
