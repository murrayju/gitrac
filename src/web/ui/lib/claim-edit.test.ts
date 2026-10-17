import { describe, expect, test } from 'bun:test';
import { ApiError } from '../api.ts';
import { type ForceSave, saveField } from './claim-edit.ts';
import { createSaveQueue } from './save-queue.ts';

/** Regression tests for #108: "Change anyway" for a refused dropdown save. */

const REFUSED = new ApiError(
  409,
  JSON.stringify({
    error: 'Issue #1 is already claimed by Bob (in_progress).',
    code: 'already_claimed',
    assignee: 'Bob',
  }),
);

function setup() {
  const errors: (string | null)[] = [];
  const queue = createSaveQueue({
    setBusy: () => {},
    setError: (e) => errors.push(e),
  });
  let retry: ForceSave | null = null;
  const onRefused = (r: ForceSave | null) => {
    retry = r;
  };
  return { errors, queue, onRefused, retry: () => retry };
}

describe('saveField', () => {
  test('an already_claimed refusal shows the message and offers a forced retry', async () => {
    const { errors, queue, onRefused, retry } = setup();
    const sent: boolean[] = [];
    const ok = await saveField(
      queue,
      'status',
      async (force) => {
        sent.push(force);
        if (!force) throw REFUSED;
      },
      onRefused,
    );
    expect(ok).toBe(false);
    expect(errors.at(-1)).toBe(
      'Failed to save status: Issue #1 is already claimed by Bob (in_progress).',
    );
    const forceSave = retry();
    expect(forceSave).not.toBeNull();

    expect(await forceSave?.()).toBe(true);
    expect(sent).toEqual([false, true]);
    // The retry clears the offer and the error.
    expect(retry()).toBeNull();
    expect(errors.at(-1)).toBeNull();
  });

  test('other failures do not offer a forced retry', async () => {
    const { errors, queue, onRefused, retry } = setup();
    for (const err of [
      new ApiError(400, JSON.stringify({ error: 'Invalid status' })),
      new ApiError(
        409,
        JSON.stringify({ error: 'Closed', code: 'issue_closed' }),
      ),
    ]) {
      const ok = await saveField(
        queue,
        'status',
        async () => {
          throw err;
        },
        onRefused,
      );
      expect(ok).toBe(false);
      expect(retry()).toBeNull();
    }
    expect(errors.at(-1)).toBe('Failed to save status: Closed');
  });

  test('a new save drops an old offer', async () => {
    const { queue, onRefused, retry } = setup();
    await saveField(
      queue,
      'status',
      async (force) => {
        if (!force) throw REFUSED;
      },
      onRefused,
    );
    expect(retry()).not.toBeNull();
    const ok = await saveField(queue, 'priority', async () => {}, onRefused);
    expect(ok).toBe(true);
    expect(retry()).toBeNull();
  });
});
