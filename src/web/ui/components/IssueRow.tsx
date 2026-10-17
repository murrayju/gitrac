import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveAssigneeName } from '../../../core/config.ts';
import type { Priority, Status } from '../../../core/types.ts';
import { type ApiIssue, updateIssue } from '../api.ts';
import { useConfig, useWorkflow } from '../hooks.ts';
import { createSaveQueue } from '../lib/save-queue.ts';
import { relativeTime } from '../lib/time.ts';
import { ClaimedElsewhereBadge } from './ClaimedElsewhereBadge.tsx';
import { ClosedElsewhereBadge } from './ClosedElsewhereBadge.tsx';
import { Dropdown } from './Dropdown.tsx';
import { LabelBadge } from './LabelBadge.tsx';
import { PriorityBadge } from './PriorityBadge.tsx';
import { StatusBadge } from './StatusBadge.tsx';

export function IssueRow({ issue }: { issue: ApiIssue }) {
  const navigate = useNavigate();
  const { config } = useConfig();
  const workflow = useWorkflow();
  // Saves go one at a time. The SSE update shows a saved value.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saves] = useState(() =>
    createSaveQueue({ setBusy: setSaving, setError: setSaveError }),
  );

  function handleStatusChange(status: Status) {
    void saves.run('status', () => updateIssue(issue.id, { status }));
  }

  function handlePriorityChange(priority: Priority) {
    void saves.run('priority', () => updateIssue(issue.id, { priority }));
  }

  return (
    <tr
      className="border-b border-gray-200/50 dark:border-gray-800/50 hover:bg-gray-100/50 dark:hover:bg-gray-900/50 cursor-pointer transition-colors"
      onClick={() => navigate(`/issues/${issue.id}`)}
      aria-busy={saving}
    >
      <td className="px-3 py-2 text-sm text-gray-500 w-16">#{issue.id}</td>
      <td className="px-3 py-2 text-sm font-medium max-w-md">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate">{issue.title}</span>
          {issue.claimedElsewhere && (
            <span className="shrink-0">
              <ClaimedElsewhereBadge claim={issue.claimedElsewhere} />
            </span>
          )}
          {issue.closedElsewhere && (
            <span className="shrink-0">
              <ClosedElsewhereBadge closed={issue.closedElsewhere} />
            </span>
          )}
        </div>
        {saveError && (
          <div
            role="alert"
            className="mt-0.5 truncate text-xs font-normal text-red-500"
            title={saveError}
          >
            {saveError}
          </div>
        )}
      </td>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation for dropdown interaction within clickable row */}
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <Dropdown
          value={issue.status}
          options={workflow.statuses}
          labels={workflow.statusLabels}
          onChange={handleStatusChange}
        >
          <StatusBadge status={issue.status} onClick={() => {}} />
        </Dropdown>
      </td>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation for dropdown interaction within clickable row */}
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <Dropdown
          value={issue.priority}
          options={workflow.priorities}
          labels={workflow.priorityLabels}
          onChange={handlePriorityChange}
        >
          <PriorityBadge priority={issue.priority} onClick={() => {}} />
        </Dropdown>
      </td>
      <td
        className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400"
        title={issue.assignee || undefined}
      >
        {issue.assignee
          ? resolveAssigneeName(config?.assignees ?? [], issue.assignee)
          : '—'}
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1 flex-wrap">
          {issue.labels.map((label) => (
            <LabelBadge
              key={label}
              label={label}
              color={config?.labels[label]}
            />
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
