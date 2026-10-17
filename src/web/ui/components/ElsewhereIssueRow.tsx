import { useNavigate } from 'react-router-dom';
import { resolveAssigneeName } from '../../../core/config.ts';
import type { FoundElsewhere } from '../../../core/elsewhere.ts';
import type { ApiIssue } from '../api.ts';
import { useConfig } from '../hooks.ts';
import { relativeTime } from '../lib/time.ts';
import { FoundElsewhereBadge } from './FoundElsewhereBadge.tsx';
import { LabelBadge } from './LabelBadge.tsx';
import { PriorityBadge } from './PriorityBadge.tsx';
import { StatusBadge } from './StatusBadge.tsx';

/**
 * A list row for an issue that exists only in another worktree or on
 * another branch. It has no file here, so it is read-only: status and
 * priority are plain badges, not dropdowns. Click opens the read-only
 * detail view.
 */
export function ElsewhereIssueRow({
  issue,
  found,
}: {
  issue: ApiIssue;
  found: FoundElsewhere;
}) {
  const navigate = useNavigate();
  const { config } = useConfig();

  return (
    <tr
      className="border-b border-gray-200/50 dark:border-gray-800/50 hover:bg-gray-100/50 dark:hover:bg-gray-900/50 cursor-pointer transition-colors opacity-80"
      onClick={() => navigate(`/issues/${issue.id}`)}
      data-testid="elsewhere-row"
    >
      <td className="px-3 py-2 text-sm text-gray-500 w-16">#{issue.id}</td>
      <td className="px-3 py-2 text-sm font-medium max-w-md">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate">{issue.title}</span>
          <span className="shrink-0">
            <FoundElsewhereBadge found={found} />
          </span>
        </div>
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={issue.status} />
      </td>
      <td className="px-3 py-2">
        <PriorityBadge priority={issue.priority} />
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
