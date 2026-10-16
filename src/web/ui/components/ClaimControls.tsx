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

type Action = 'claim' | 'unclaim';

/**
 * "Claim" / "Release" for the issue sidebar, as the "Acting as" user. They
 * go through `POST /api/issues/:id/claim` / `unclaim`, so the CLI's claim
 * rules apply (also to claims in other worktrees and on other branches). A
 * refusal is shown inline; if someone else holds the issue, the user can
 * retry with `force` ("Take over" / "Release anyway").
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
  if (!actions.claim && !actions.release && !conflict && !error) return null;

  async function run(action: Action, force: boolean) {
    setBusy(true);
    setError(null);
    setConflict(null);
    const input = {
      author: effectiveAuthor(stored, identity?.name ?? null, assignees),
      force: force || undefined,
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
      <div className="flex flex-wrap gap-2">
        {actions.claim && (
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => run('claim', false)}
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
            onClick={() => run('unclaim', false)}
            title="Clear the assignee and give the issue back"
          >
            Release
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
                onClick={() => run(conflict.action, true)}
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
