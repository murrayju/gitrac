import { resolveAssigneeName } from '../../../core/config.ts';
import type { StaleClaim } from '../../../core/stale.ts';
import { useConfig } from '../hooks.ts';
import { staleClaimText, staleClaimTitle } from '../lib/claimed-elsewhere.ts';

/**
 * "stale: no activity for 3h": the issue's claim has had no activity for at
 * least the configured `staleAfter` (`staleClaim` from the API), e.g.
 * because its agent stopped. The claim's own badge stays as it is.
 */
export function StaleClaimBadge({ claim }: { claim: StaleClaim }) {
  const { config } = useConfig();
  const who = resolveAssigneeName(config?.assignees ?? [], claim.assignee);

  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-medium max-w-full break-words bg-red-900 text-red-300"
      title={staleClaimTitle(claim, who, config?.staleAfter)}
      data-testid="stale-claim"
    >
      {staleClaimText(claim, Date.now())}
    </span>
  );
}
