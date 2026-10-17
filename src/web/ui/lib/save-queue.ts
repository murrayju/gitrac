import { type RequestStateSetters, trackRequest } from './request-state.ts';

/**
 * Field saves from a dropdown (status, priority, assignee). A user can pick
 * a second value while the first save runs. The queue sends the saves one
 * at a time, in order, so the last pick wins and no pick is lost.
 */
export interface SaveQueue {
  /**
   * Queue `action`, a save of `field`. Clears the error now. If the save
   * fails, the error is `Failed to save <field>: <reason>`. Resolves to
   * `true` if the save succeeded. Never rejects.
   */
  run(field: string, action: () => Promise<unknown>): Promise<boolean>;
}

/**
 * Make a save queue. Busy is `true` from the first queued save until the
 * queue is empty. Each save goes through `trackRequest`.
 */
export function createSaveQueue({
  setBusy,
  setError,
}: RequestStateSetters): SaveQueue {
  let queue: Promise<unknown> = Promise.resolve();
  let pending = 0;

  return {
    run(field, action) {
      pending++;
      // Start this save when the saves before it settle
      const previous = queue;
      const result = trackRequest(
        async () => {
          await previous;
          await action();
        },
        {
          setBusy: (busy) => {
            if (busy) {
              setBusy(true);
              return;
            }
            pending--;
            if (pending === 0) setBusy(false);
          },
          setError: (error) =>
            setError(
              error === null ? null : `Failed to save ${field}: ${error}`,
            ),
        },
      );
      queue = result;
      return result;
    },
  };
}
