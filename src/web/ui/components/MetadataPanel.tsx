import { useEffect, useRef, useState } from 'react';
import { resolveAssigneeName } from '../../../core/config.ts';
import type { Issue, Priority, Status } from '../../../core/types.ts';
import {
  type ApiIssue,
  type UpdateIssueInput,
  updateIssue,
  updateIssueVersioned,
  type Versioned,
} from '../api.ts';
import { useConfig, useServerIdentity, useWorkflow } from '../hooks.ts';
import { type ForceSave, saveField } from '../lib/claim-edit.ts';
import { effectiveAuthor } from '../lib/identity.ts';
import {
  addLabel,
  createLabelUpdater,
  toggleLabel,
} from '../lib/label-updates.ts';
import { createSaveQueue } from '../lib/save-queue.ts';
import { requestErrorReason } from '../lib/upload-error.ts';
import { useIdentityStore } from '../stores/identityStore.ts';
import { AssigneePicker } from './AssigneePicker.tsx';
import { ClaimControls } from './ClaimControls.tsx';
import { ClaimedElsewhereBadge } from './ClaimedElsewhereBadge.tsx';
import { ClosedElsewhereBadge } from './ClosedElsewhereBadge.tsx';
import { Dropdown } from './Dropdown.tsx';
import { LabelBadge } from './LabelBadge.tsx';
import { LabelPicker } from './LabelPicker.tsx';
import { PriorityBadge } from './PriorityBadge.tsx';
import { StatusBadge } from './StatusBadge.tsx';

export function MetadataPanel({
  issue,
  version,
  onSaved,
}: {
  issue: ApiIssue;
  /** The version shown (ETag), for claim / release. */
  version: string | null;
  /** A label save, claim or release returned this issue (and its version). */
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
  // Status, priority and assignee saves go one at a time and share one
  // error line. The SSE update shows a saved value.
  const [fieldSaving, setFieldSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [fieldSaves] = useState(() =>
    createSaveQueue({ setBusy: setFieldSaving, setError: setFieldError }),
  );
  // A status or assignee save the server refused because someone else
  // holds the issue: "Change anyway" sends it again with force.
  const [forceSave, setForceSave] = useState<ForceSave | null>(null);
  // An error is about the issue it was made on: drop it on another issue
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on issue change
  useEffect(() => {
    setFieldError(null);
    setForceSave(null);
  }, [issue.id]);
  // Status and assignee changes are made as the "Acting as" user, so the
  // server can tell if they would overwrite someone else's claim.
  const { identity } = useServerIdentity();
  const storedAuthor = useIdentityStore((s) => s.author);
  const author = effectiveAuthor(
    storedAuthor,
    identity?.name ?? null,
    config?.assignees ?? [],
  );

  function save(field: string, input: UpdateIssueInput) {
    const id = issue.id;
    void saveField(
      fieldSaves,
      field,
      (force) =>
        updateIssue(id, { ...input, author, force: force || undefined }),
      (retry) => setForceSave(() => retry),
    );
  }

  function handleStatusChange(status: Status) {
    save('status', { status });
  }

  function handlePriorityChange(priority: Priority) {
    save('priority', { priority });
  }

  function handleAssigneeChange(email: string) {
    if (email === issue.assignee) return;
    save('assignee', { assignee: email });
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
    <div className="space-y-4 text-sm" aria-busy={fieldSaving}>
      {fieldError && (
        <div role="alert" className="text-xs text-red-500 break-words">
          {fieldError}
          {forceSave && (
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                className="px-2 py-0.5 rounded border text-xs cursor-pointer disabled:opacity-50 border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                disabled={fieldSaving}
                onClick={() => void forceSave()}
              >
                Change anyway
              </button>
            </div>
          )}
        </div>
      )}
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
        <ClaimControls
          key={issue.id}
          issue={issue}
          version={version}
          onSaved={onSaved}
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
