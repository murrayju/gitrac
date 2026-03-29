import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { updateIssue } from '../api.ts';
import { useIssue } from '../hooks.ts';
import { relativeTime } from '../lib/time.ts';
import { CommentEditor } from './CommentEditor.tsx';
import { CommentList } from './CommentList.tsx';
import { IssueEditor } from './IssueEditor.tsx';
import { MetadataPanel } from './MetadataPanel.tsx';

export function IssueDetail() {
  const { id } = useParams<{ id: string }>();
  const issueId = Number(id);
  const { issue, loading, error } = useIssue(issueId);
  const [editingTitle, setEditingTitle] = useState(false);
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

  async function handleDescriptionChange(markdown: string) {
    if (!issue) return;
    await updateIssue(issue.id, { description: markdown });
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
            <IssueEditor
              content={issue.description}
              onChange={handleDescriptionChange}
            />
          </div>

          {/* Divider */}
          <hr className="border-gray-200 dark:border-gray-800 mb-6" />

          {/* Comments */}
          <div className="mb-6">
            <h2 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-4">
              Comments ({issue.comments.length})
            </h2>
            <CommentList comments={issue.comments} issueId={issue.id} />
          </div>

          {/* Comment editor */}
          <CommentEditor issueId={issue.id} />
        </div>

        {/* Metadata sidebar */}
        <div className="w-56 shrink-0">
          <MetadataPanel issue={issue} />
        </div>
      </div>
    </div>
  );
}
