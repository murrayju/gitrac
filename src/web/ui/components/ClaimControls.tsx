import { useState } from 'react';
import type { Issue } from '../../../core/types.ts';
import {
  type ApiIssue,
  ConflictError,
  claimIssue,
  unclaimIssue,
} from '../api.ts';
import { useConfig, useServerIdentity } from '../hooks.ts';
import {
  actingUser,
  type ClaimConflict,
  claimActions,
  claimConflict,
} from '../lib/claim.ts';
import { effectiveAuthor } from '../lib/identity.ts';
import { requestErrorReason } from '../lib/upload-error.ts';
import { useIdentityStore } from '../stores/identityStore.ts';
import { StaleClaimBadge } from './StaleClaimBadge.tsx';

type Action = 'claim' | 'unclaim';

/** How to send a claim / unclaim (see `ClaimInput`). */
interface RunOptions {
  force?: boolean;
  renew?: boolean;
  stale?: string;
}

/**
 * "Claim" / "Release" for the issue sidebar, as the "Acting as" user. They
 * go through `POST /api/issues/:id/claim` / `unclaim`, so the CLI's claim
 * rules apply (also to claims in other worktrees and on other branches). A
 * refusal is shown inline; if someone else holds the issue, the user can
 * retry with `force` ("Take over" / "Release anyway"). "Renew" renews the
 * user's own claim (`renew`). For a stale claim by someone else (see
 * `staleAfter`), "Release stale claim" sends `stale`, so the server
 * releases it only if it is still stale.
 */
export function ClaimControls({
  issue,
  version,
  onSaved,
}: {
  issue: ApiIssue;
  /** The version shown, sent as `If-Match`. */
  version: string | null;
  /** The request returned this issue (and its version). */
  onSaved: (issue: Issue, version: string | null) => void;
}) {
  const { config } = useConfig();
  const { identity } = useServerIdentity();
  const stored = useIdentityStore((s) => s.author);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<
    (ClaimConflict & { action: Action }) | null
  >(null);

  const assignees = config?.assignees ?? [];
  const user = actingUser(stored, identity, assignees);
  const actions = claimActions(issue, user, config);
  const any =
    actions.claim || actions.release || actions.renew || actions.releaseStale;
  if (!any && !conflict && !error && !issue.staleClaim) return null;

  async function run(action: Action, options: RunOptions = {}) {
    setBusy(true);
    setError(null);
    setConflict(null);
    const input = {
      author: effectiveAuthor(stored, identity?.name ?? null, assignees),
      force: options.force || undefined,
      renew: options.renew || undefined,
      stale: options.stale,
    };
    try {
      const send = action === 'claim' ? claimIssue : unclaimIssue;
      const { data, version: saved } = await send(issue.id, input, version);
      onSaved(data, saved);
    } catch (e) {
      if (e instanceof ConflictError) {
        // Changed since it was loaded: show the latest, to decide again.
        onSaved(e.current, e.version);
        setError(
          'This issue changed since it was loaded. The latest version is now shown; try again.',
        );
        return;
      }
      const refused = claimConflict(e);
      if (refused) setConflict({ ...refused, action });
      else setError(requestErrorReason(e));
    } finally {
      setBusy(false);
    }
  }

  const button =
    'px-2 py-0.5 rounded border text-xs cursor-pointer disabled:opacity-50 border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800';

  return (
    <div className="mt-2" data-testid="claim-controls">
      {issue.staleClaim && (
        <div className="mb-2">
          <StaleClaimBadge claim={issue.staleClaim} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.claim && (
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => run('claim')}
            title={user ? `Assign to ${user.name} and start work` : undefined}
          >
            Claim
          </button>
        )}
        {actions.release && (
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => run('unclaim')}
            title="Clear the assignee and give the issue back"
          >
            Release
          </button>
        )}
        {actions.renew && (
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => run('claim', { renew: true })}
            title="Renew your claim (a heartbeat), so it does not become stale"
          >
            Renew
          </button>
        )}
        {actions.releaseStale && (
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => run('unclaim', { stale: config?.staleAfter })}
            title={`Release the claim only if it still has no activity for ${config?.staleAfter}`}
          >
            Release stale claim
          </button>
        )}
      </div>
      {(conflict || error) && (
        <div role="alert" className="mt-2 text-xs text-red-500 break-words">
          {conflict?.message ?? error}
          {conflict?.canForce && (
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => run(conflict.action, { force: true })}
              >
                {conflict.action === 'claim' ? 'Take over' : 'Release anyway'}
              </button>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => setConflict(null)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
