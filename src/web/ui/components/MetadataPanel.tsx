import { resolveAssigneeName } from '../../../core/config.ts';
import type { Priority, Status } from '../../../core/types.ts';
import { type ApiIssue, updateIssue } from '../api.ts';
import { useConfig, useWorkflow } from '../hooks.ts';
import { AssigneePicker } from './AssigneePicker.tsx';
import { ClaimedElsewhereBadge } from './ClaimedElsewhereBadge.tsx';
import { ClosedElsewhereBadge } from './ClosedElsewhereBadge.tsx';
import { Dropdown } from './Dropdown.tsx';
import { LabelBadge } from './LabelBadge.tsx';
import { LabelPicker } from './LabelPicker.tsx';
import { PriorityBadge } from './PriorityBadge.tsx';
import { StatusBadge } from './StatusBadge.tsx';

export function MetadataPanel({ issue }: { issue: ApiIssue }) {
  const { config } = useConfig();
  const workflow = useWorkflow();

  async function handleStatusChange(status: Status) {
    await updateIssue(issue.id, { status });
  }

  async function handlePriorityChange(priority: Priority) {
    await updateIssue(issue.id, { priority });
  }

  async function handleAssigneeChange(email: string) {
    if (email !== issue.assignee) {
      await updateIssue(issue.id, { assignee: email });
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

  const assigneeName = resolveAssigneeName(
    config?.assignees ?? [],
    issue.assignee,
  );

  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">
          Status
        </div>
        <Dropdown
          value={issue.status}
          options={workflow.statuses}
          labels={workflow.statusLabels}
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
          options={workflow.priorities}
          labels={workflow.priorityLabels}
          onChange={handlePriorityChange}
        >
          <PriorityBadge priority={issue.priority} onClick={() => {}} />
        </Dropdown>
      </div>

      <div>
        <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">
          Assignee
        </div>
        <AssigneePicker
          value={issue.assignee}
          onChange={handleAssigneeChange}
          trigger={
            <span
              className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100 cursor-pointer"
              title={issue.assignee || undefined}
            >
              {assigneeName || 'Unassigned'}
            </span>
          }
        />
      </div>

      {(issue.claimedElsewhere || issue.closedElsewhere) && (
        <div>
          <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">
            Elsewhere
          </div>
          {issue.claimedElsewhere && (
            <ClaimedElsewhereBadge
              claim={issue.claimedElsewhere}
              variant="full"
            />
          )}
          {issue.closedElsewhere && (
            <ClosedElsewhereBadge
              closed={issue.closedElsewhere}
              variant="full"
            />
          )}
        </div>
      )}

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
