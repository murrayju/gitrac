import { useRef, useState } from 'react';
import { resolveAssigneeName } from '../../../core/config.ts';
import type { Issue, Priority, Status } from '../../../core/types.ts';
import {
  type ApiIssue,
  updateIssue,
  updateIssueVersioned,
  type Versioned,
} from '../api.ts';
import { useConfig, useWorkflow } from '../hooks.ts';
import {
  addLabel,
  createLabelUpdater,
  toggleLabel,
} from '../lib/label-updates.ts';
import { requestErrorReason } from '../lib/upload-error.ts';
import { AssigneePicker } from './AssigneePicker.tsx';
import { ClaimedElsewhereBadge } from './ClaimedElsewhereBadge.tsx';
import { ClosedElsewhereBadge } from './ClosedElsewhereBadge.tsx';
import { Dropdown } from './Dropdown.tsx';
import { LabelBadge } from './LabelBadge.tsx';
import { LabelPicker } from './LabelPicker.tsx';
import { PriorityBadge } from './PriorityBadge.tsx';
import { StatusBadge } from './StatusBadge.tsx';

export function MetadataPanel({
  issue,
  onSaved,
}: {
  issue: ApiIssue;
  /** A label save returned this issue (and its version). */
  onSaved: (issue: Issue, version: string | null) => void;
}) {
  const { config } = useConfig();
  const workflow = useWorkflow();
  // Labels of edits not yet saved (null: show the props). Rapid toggles
  // apply to these, and the PATCHes go one at a time, so no toggle is lost.
  const [pendingLabels, setPendingLabels] = useState<string[] | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const issueIdRef = useRef(issue.id);
  issueIdRef.current = issue.id;
  const [labelUpdater] = useState(() =>
    createLabelUpdater<Versioned<Issue>>({
      // No If-Match: like the other metadata edits, this sends only the
      // changed field (last writer wins).
      save: (labels) =>
        updateIssueVersioned(issueIdRef.current, { labels }, null),
      onPending: setPendingLabels,
      onSaved: ({ data, version }) => onSavedRef.current(data, version),
      onError: (e) => setLabelError(requestErrorReason(e)),
    }),
  );
  const labels = pendingLabels ?? issue.labels;

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

  function handleToggleLabel(label: string) {
    setLabelError(null);
    void labelUpdater.update(issue.labels, (l) => toggleLabel(l, label));
  }

  function handleCreateLabel(label: string) {
    setLabelError(null);
    void labelUpdater.update(issue.labels, (l) => addLabel(l, label));
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
          {labels.map((label) => (
            <LabelBadge
              key={label}
              label={label}
              color={config?.labels[label]}
              onRemove={() => handleToggleLabel(label)}
            />
          ))}
        </div>
        {labelError && (
          <div role="alert" className="mb-2 text-xs text-red-500">
            Failed to save labels: {labelError}
          </div>
        )}
        <LabelPicker
          selectedLabels={labels}
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
