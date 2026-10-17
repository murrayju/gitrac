import { Link } from 'react-router-dom';
import { resolveAssigneeName } from '../../../core/config.ts';
import type { FoundElsewhere } from '../../../core/elsewhere.ts';
import type { ApiIssue } from '../api.ts';
import { useConfig, useIssueDependencies } from '../hooks.ts';
import { foundElsewhereNotice } from '../lib/claimed-elsewhere.ts';
import { commentKeys } from '../lib/comment-write.ts';
import { relativeTime } from '../lib/time.ts';
import { RefList } from './DependenciesPanel.tsx';
import { FoundElsewhereBadge } from './FoundElsewhereBadge.tsx';
import { LabelBadge } from './LabelBadge.tsx';
import { MarkdownContent } from './MarkdownContent.tsx';
import { PriorityBadge } from './PriorityBadge.tsx';
import { StatusBadge } from './StatusBadge.tsx';

/**
 * Read-only detail view of an issue that has no file in this working tree
 * but exists in another worktree or on another branch (`foundElsewhere`
 * from `GET /api/issues/:id`). Every mutation of it is a 404 here, so this
 * view has no editors: it shows the issue as found there, and says where.
 */
export function ElsewhereIssueView({
  issue,
  found,
}: {
  issue: ApiIssue;
  found: FoundElsewhere;
}) {
  const { config } = useConfig();
  const assignees = config?.assignees ?? [];
  const keys = commentKeys(issue.comments);

  return (
    <div className="p-6 max-w-5xl mx-auto" data-testid="elsewhere-issue">
      <div
        className="mb-6 px-3 py-2 rounded border border-amber-300 bg-amber-50 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        role="note"
      >
        {foundElsewhereNotice(found)}
      </div>
      <div className="flex gap-8">
        <div className="flex-1 min-w-0">
          <div className="mb-1">
            <span className="text-gray-500 text-sm">#{issue.id}</span>
          </div>
          <h1 className="text-xl font-semibold mb-4">{issue.title}</h1>
          <div className="text-xs text-gray-500 mb-6">
            Created by {issue.createdBy} {relativeTime(issue.created)} &middot;
            Updated {relativeTime(issue.updated)}
          </div>
          <div className="mb-8">
            {issue.description.trim() ? (
              <MarkdownContent content={issue.description} />
            ) : (
              <div className="text-gray-500 text-sm">No description.</div>
            )}
          </div>
          <hr className="border-gray-200 dark:border-gray-800 mb-6" />
          <h2 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-4">
            Comments ({issue.comments.length})
          </h2>
          {issue.comments.length === 0 ? (
            <div className="text-gray-500 text-sm py-4">No comments yet.</div>
          ) : (
            <div className="space-y-4">
              {issue.comments.map((comment, index) => (
                <div key={keys[index]}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {comment.author}
                    </span>
                    <span
                      className="text-xs text-gray-500"
                      title={new Date(comment.timestamp).toLocaleString()}
                    >
                      {relativeTime(comment.timestamp)}
                    </span>
                  </div>
                  <MarkdownContent content={comment.body} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="w-56 shrink-0 space-y-4 text-sm">
          <Field title="Elsewhere">
            <FoundElsewhereBadge found={found} variant="full" />
          </Field>
          <Field title="Status">
            <StatusBadge status={issue.status} />
          </Field>
          <Field title="Priority">
            <PriorityBadge priority={issue.priority} />
          </Field>
          <Field title="Assignee">
            <span
              className="text-gray-700 dark:text-gray-300"
              title={issue.assignee || undefined}
            >
              {issue.assignee
                ? resolveAssigneeName(assignees, issue.assignee)
                : 'Unassigned'}
            </span>
          </Field>
          <Field title="Labels">
            {issue.labels.length === 0 ? (
              <span className="text-gray-500">None</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {issue.labels.map((label) => (
                  <LabelBadge
                    key={label}
                    label={label}
                    color={config?.labels[label]}
                  />
                ))}
              </div>
            )}
          </Field>
          <ReadOnlyDependencies issueId={issue.id} />
          <Link
            to="/"
            className="block text-xs text-gray-500 hover:underline pt-4"
          >
            Back to issues
          </Link>
        </div>
      </div>
    </div>
  );
}

function Field({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

/** The issue's links, resolved against the local issues; no editing. */
function ReadOnlyDependencies({ issueId }: { issueId: number }) {
  const { dependencies: deps } = useIssueDependencies(issueId);
  if (!deps) return null;
  return (
    <div className="space-y-4" data-testid="dependencies">
      {deps.blocked && (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          Blocked by an open issue
        </div>
      )}
      <RefList title="Parent" refs={deps.parent ? [deps.parent] : []} />
      <RefList title="Sub-issues" refs={deps.children} />
      <RefList title="Blocked by" refs={deps.blockedBy} />
      <RefList title="Blocks" refs={deps.blocks} />
    </div>
  );
}
