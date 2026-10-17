import { claimConflict } from './claim.ts';
import type { SaveQueue } from './save-queue.ts';

/**
 * Dropdown saves (`PATCH /api/issues/:id`) that the server can refuse. A
 * status or assignee change of an issue someone else holds (here, in
 * another worktree or on another branch) is 409 `already_claimed`. The
 * error line then shows the server's message, and the user can send the
 * same change again with `force` ("Change anyway").
 */

/** Sends the change; with `force`, even if someone else holds the issue. */
export type FieldSend = (force: boolean) => Promise<unknown>;

/** Sends the refused change again with `force`. */
export type ForceSave = () => Promise<boolean>;

/**
 * Queue a save of `field`. `onRefused` gets `null` when the save is
 * queued (so an old "Change anyway" goes away), and a {@link ForceSave} if
 * the server refuses the save because someone else holds the issue. Other
 * failures go to the queue's error line only. Resolves to `true` if the
 * save succeeded. Never rejects.
 */
export function saveField(
  queue: SaveQueue,
  field: string,
  send: FieldSend,
  onRefused: (forceSave: ForceSave | null) => void,
): Promise<boolean> {
  onRefused(null);
  return queue.run(field, async () => {
    try {
      await send(false);
    } catch (err) {
      if (claimConflict(err)?.code === 'already_claimed') {
        onRefused(() => {
          onRefused(null);
          return queue.run(field, () => send(true));
        });
      }
      throw err;
    }
  });
}
