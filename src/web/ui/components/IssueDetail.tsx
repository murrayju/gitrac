import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Issue } from '../../../core/types.ts';
import {
  ConflictError,
  deleteIssue,
  fetchDeletePlan,
  type IssueDeletion,
  updateIssue,
  type Versioned,
} from '../api.ts';
import { useIssue } from '../hooks.ts';
import { relativeTime } from '../lib/time.ts';
import { CommentEditor } from './CommentEditor.tsx';
import { CommentList } from './CommentList.tsx';
import { DeleteIssueDialog } from './DeleteIssueDialog.tsx';
import { DependenciesPanel } from './DependenciesPanel.tsx';
import { DescriptionEditor } from './DescriptionEditor.tsx';
import { MetadataPanel } from './MetadataPanel.tsx';

export function IssueDetail() {
  const { id } = useParams<{ id: string }>();
  const issueId = Number(id);
  const { issue, version, loading, error, refetch, applyIssue } =
    useIssue(issueId);
  const navigate = useNavigate();
  const [editingTitle, setEditingTitle] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [deletePlan, setDeletePlan] = useState<Versioned<IssueDeletion> | null>(
    null,
  );
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [editingTitle]);

  if (loading && !issue) {
    return <div className="p-6 text-gray-500">Loading...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-400">Error: {error}</div>;
  }

  if (!issue) {
    return <div className="p-6 text-gray-500">Issue not found.</div>;
  }

  function startEditTitle() {
    if (!issue) return;
    setTitleDraft(issue.title);
    setEditingTitle(true);
  }

  async function saveTitle() {
    if (!issue) return;
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== issue.title) {
      await updateIssue(issue.id, { title: trimmed });
    }
  }

  /** A 409: show the latest version, to review before deleting again. */
  function handleDeleteConflict(e: ConflictError) {
    applyIssue(e.current, e.version);
    window.alert(
      'This issue was changed elsewhere since it was loaded. The latest version is now shown; review it and delete again if you still want to.',
    );
  }

  // Ask the server what deleting would remove and unlink (a dry run guarded
  // by the version shown), then confirm in a dialog listing it.
  async function handleDelete() {
    if (!issue) return;
    setPlanning(true);
    try {
      setDeletePlan(await fetchDeletePlan(issue.id, version));
    } catch (e) {
      if (e instanceof ConflictError) {
        handleDeleteConflict(e);
        return;
      }
      window.alert(`Failed to prepare deletion: ${(e as Error).message}`);
    } finally {
      setPlanning(false);
    }
  }

  // Guarded by the version the plan was made from, so what is deleted is
  // what the dialog listed; a change made elsewhere since is reviewed first.
  async function confirmDelete() {
    if (!issue || !deletePlan) return;
    setDeleting(true);
    try {
      await deleteIssue(issue.id, deletePlan.version ?? version);
      navigate('/');
    } catch (e) {
      setDeleting(false);
      setDeletePlan(null);
      if (e instanceof ConflictError) {
        handleDeleteConflict(e);
        return;
      }
      window.alert(`Failed to delete issue: ${(e as Error).message}`);
    }
  }

  /** A save returned the issue: show it, then check for newer changes. */
  function handleIssueSaved(saved: Issue, savedVersion: string | null) {
    applyIssue(saved, savedVersion);
    // Pick up anything that changed while the save was in flight
    refetch();
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex gap-8">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="mb-1">
            <span className="text-gray-500 text-sm">#{issue.id}</span>
          </div>
          {editingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle();
                if (e.key === 'Escape') setEditingTitle(false);
              }}
              className="w-full text-xl font-semibold bg-transparent border-b border-gray-300 dark:border-gray-700 focus:border-blue-500 outline-none pb-1 mb-4"
            />
          ) : (
            <div className="mb-4">
              <button
                type="button"
                className="text-xl font-semibold cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 bg-transparent border-none p-0 text-left"
                onClick={startEditTitle}
                title="Click to edit"
              >
                {issue.title}
              </button>
            </div>
          )}

          <div className="text-xs text-gray-500 mb-6">
            Created by {issue.createdBy} {relativeTime(issue.created)} &middot;
            Updated {relativeTime(issue.updated)}
          </div>

          {/* Description editor */}
          <div className="mb-8">
            <DescriptionEditor
              issueId={issue.id}
              description={issue.description}
              version={version}
              onSaved={handleIssueSaved}
            />
          </div>

          {/* Divider */}
          <hr className="border-gray-200 dark:border-gray-800 mb-6" />

          {/* Comments */}
          <div className="mb-6">
            <h2 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-4">
              Comments ({issue.comments.length})
            </h2>
            <CommentList
              comments={issue.comments}
              issueId={issue.id}
              version={version}
              onConflict={applyIssue}
            />
          </div>

          {/* Comment editor */}
          <CommentEditor issueId={issue.id} />
        </div>

        {/* Metadata sidebar */}
        <div className="w-56 shrink-0">
          <MetadataPanel
            issue={issue}
            version={version}
            onSaved={handleIssueSaved}
          />
          <DependenciesPanel issueId={issue.id} />
          <div className="mt-8 pt-4 border-t border-gray-200 dark:border-gray-800">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting || planning || deletePlan !== null}
              className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 cursor-pointer bg-transparent border-none p-0"
            >
              {deleting ? 'Deleting…' : planning ? 'Checking…' : 'Delete issue'}
            </button>
          </div>
        </div>
      </div>
      {deletePlan && (
        <DeleteIssueDialog
          plan={deletePlan.data}
          deleting={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setDeletePlan(null)}
        />
      )}
    </div>
  );
}
