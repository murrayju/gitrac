import { resolveAssigneeName } from '../../../core/config.ts';
import type { ClaimedElsewhere } from '../../../core/elsewhere.ts';
import { activeStatus } from '../../../core/workflow.ts';
import { useConfig, useWorkflow } from '../hooks.ts';
import { fullClaimText, shortClaimText } from '../lib/claimed-elsewhere.ts';
import { relativeTime } from '../lib/time.ts';
import { statusBadgeStyle } from '../lib/workflow.ts';

/**
 * "Claimed by X in worktree/branch Y": the issue's newest version is a claim
 * in another worktree or on another branch (`claimedElsewhere` from the
 * API). Styled like the active status's badge. `variant="full"` spells out
 * the location (detail view); the compact one shows the full text on hover.
 */
export function ClaimedElsewhereBadge({
  claim,
  variant = 'short',
}: {
  claim: ClaimedElsewhere;
  variant?: 'short' | 'full';
}) {
  const { config } = useConfig();
  const workflow = useWorkflow();
  const who = resolveAssigneeName(config?.assignees ?? [], claim.assignee);
  const full = fullClaimText(claim, who);
  // Before the config has loaded, the active status is unknown: neutral.
  const { className, style } = statusBadgeStyle(
    workflow.source,
    config ? activeStatus(config) : '',
  );
  const title = `${full} (${claim.assignee}), ${relativeTime(claim.updated)}`;

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium max-w-full break-words ${className}`}
      style={style}
      title={title}
      data-testid="claimed-elsewhere"
    >
      {variant === 'full' ? full : shortClaimText(claim, who)}
    </span>
  );
}
