import type { ClosedElsewhere } from '../../../core/elsewhere.ts';
import { useWorkflow } from '../hooks.ts';
import { fullCloseText, shortCloseText } from '../lib/claimed-elsewhere.ts';
import { relativeTime } from '../lib/time.ts';
import { statusBadgeStyle } from '../lib/workflow.ts';

/**
 * "Done in worktree/branch Y": the issue is open here, but its newest
 * version is closed in another worktree or on another branch
 * (`closedElsewhere` from the API), e.g. work that waits for a merge. Styled
 * like the badge of that closed status. `variant="full"` spells out the
 * location (detail view); the compact one shows the full text on hover.
 */
export function ClosedElsewhereBadge({
  closed,
  variant = 'short',
}: {
  closed: ClosedElsewhere;
  variant?: 'short' | 'full';
}) {
  const workflow = useWorkflow();
  const label = workflow.statusLabels[closed.status] ?? closed.status;
  const full = fullCloseText(closed, label);
  const { className, style } = statusBadgeStyle(workflow.source, closed.status);
  const title = `${full}, ${relativeTime(closed.updated)}`;

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium max-w-full break-words ${className}`}
      style={style}
      title={title}
      data-testid="closed-elsewhere"
    >
      {variant === 'full' ? full : shortCloseText(closed, label)}
    </span>
  );
}
