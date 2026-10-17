import type { FoundElsewhere } from '../../../core/elsewhere.ts';
import { fullFoundText, shortFoundText } from '../lib/claimed-elsewhere.ts';

/**
 * "Only in worktree/branch Y": the issue has no file in this working tree,
 * but exists in another worktree or on another branch (`foundElsewhere`
 * from the API), e.g. an issue an agent filed. `variant="full"` spells out
 * the location; the compact one shows the full text on hover.
 */
export function FoundElsewhereBadge({
  found,
  variant = 'short',
}: {
  found: FoundElsewhere;
  variant?: 'short' | 'full';
}) {
  const full = fullFoundText(found);
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-medium max-w-full break-words border border-dashed border-gray-400 text-gray-600 dark:border-gray-600 dark:text-gray-400"
      title={full}
      data-testid="found-elsewhere"
    >
      {variant === 'full' ? full : shortFoundText(found)}
    </span>
  );
}
