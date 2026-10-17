import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveAssigneeName } from '../../../core/config.ts';
import type { Priority, Status } from '../../../core/types.ts';
import { type ApiIssue, type UpdateIssueInput, updateIssue } from '../api.ts';
import { useConfig, useServerIdentity, useWorkflow } from '../hooks.ts';
import { type ForceSave, saveField } from '../lib/claim-edit.ts';
import { effectiveAuthor } from '../lib/identity.ts';
import { createSaveQueue } from '../lib/save-queue.ts';
import { relativeTime } from '../lib/time.ts';
import { useIdentityStore } from '../stores/identityStore.ts';
import { ClaimedElsewhereBadge } from './ClaimedElsewhereBadge.tsx';
import { ClosedElsewhereBadge } from './ClosedElsewhereBadge.tsx';
import { Dropdown } from './Dropdown.tsx';
import { LabelBadge } from './LabelBadge.tsx';
import { PriorityBadge } from './PriorityBadge.tsx';
import { StaleClaimBadge } from './StaleClaimBadge.tsx';
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

  // A status save the server refused because someone else holds the
  // issue: "Change anyway" sends it again with force.
  const [forceSave, setForceSave] = useState<ForceSave | null>(null);
  // Saves are made as the "Acting as" user.
  const { identity } = useServerIdentity();
  const storedAuthor = useIdentityStore((s) => s.author);
  const author = effectiveAuthor(
    storedAuthor,
    identity?.name ?? null,
    config?.assignees ?? [],
  );

  function save(field: string, input: UpdateIssueInput) {
    void saveField(
      saves,
      field,
      (force) =>
        updateIssue(issue.id, { ...input, author, force: force || undefined }),
      (retry) => setForceSave(() => retry),
    );
  }

  function handleStatusChange(status: Status) {
    save('status', { status });
  }

  function handlePriorityChange(priority: Priority) {
    save('priority', { priority });
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
          {issue.staleClaim && (
            <span className="shrink-0">
              <StaleClaimBadge claim={issue.staleClaim} />
            </span>
          )}
        </div>
        {saveError && (
          // biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation so "Change anyway" does not open the issue
          <div
            role="alert"
            className="mt-0.5 flex items-center gap-2 text-xs font-normal text-red-500"
            title={saveError}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="truncate">{saveError}</span>
            {forceSave && (
              <button
                type="button"
                className="shrink-0 px-1.5 rounded border cursor-pointer disabled:opacity-50 border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                disabled={saving}
                onClick={() => void forceSave()}
              >
                Change anyway
              </button>
            )}
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
