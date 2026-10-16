import { describe, expect, test } from 'bun:test';
import {
  addLabel,
  createLabelUpdater,
  sameLabels,
  toggleLabel,
} from './label-updates.ts';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** An updater whose saves wait until the test settles them. */
function setup() {
  const saves: {
    labels: string[];
    done: ReturnType<typeof deferred<string>>;
  }[] = [];
  const pending: (string[] | null)[] = [];
  const saved: string[] = [];
  const errors: unknown[] = [];
  const updater = createLabelUpdater<string>({
    save: (labels) => {
      const done = deferred<string>();
      saves.push({ labels, done });
      return done.promise;
    },
    onPending: (labels) => pending.push(labels),
    onSaved: (result) => saved.push(result),
    onError: (e) => errors.push(e),
  });
  return { updater, saves, pending, saved, errors };
}

describe('label list helpers', () => {
  test('toggleLabel adds a missing label and removes a present one', () => {
    expect(toggleLabel(['bug'], 'ui')).toEqual(['bug', 'ui']);
    expect(toggleLabel(['bug', 'ui'], 'bug')).toEqual(['ui']);
  });

  test('addLabel does not add a label twice', () => {
    expect(addLabel(['bug'], 'ui')).toEqual(['bug', 'ui']);
    expect(addLabel(['bug'], 'bug')).toEqual(['bug']);
  });

  test('sameLabels compares labels and order', () => {
    expect(sameLabels(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameLabels(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameLabels(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('createLabelUpdater', () => {
  test('two quick toggles from the same props keep both (#100)', async () => {
    const { updater, saves, pending, saved } = setup();
    const props = ['bug'];
    // The second click comes before any response, so the props are stale
    void updater.update(props, (l) => toggleLabel(l, 'ui'));
    await tick();
    const done = updater.update(props, (l) => toggleLabel(l, 'docs'));
    expect(pending.at(-1)).toEqual(['bug', 'ui', 'docs']);

    // One save at a time: the second waits for the first
    expect(saves.map((s) => s.labels)).toEqual([['bug', 'ui']]);
    saves[0]?.done.resolve('first');
    await tick();
    expect(saves.map((s) => s.labels)).toEqual([
      ['bug', 'ui'],
      ['bug', 'ui', 'docs'],
    ]);
    // Still pending: the panel keeps showing both toggles
    expect(saved).toEqual([]);
    expect(pending.at(-1)).toEqual(['bug', 'ui', 'docs']);

    saves[1]?.done.resolve('second');
    await done;
    expect(saved).toEqual(['second']);
    expect(pending.at(-1)).toBeNull();
  });

  test('edits before the first save starts are sent as one save', async () => {
    const { updater, saves, saved } = setup();
    void updater.update([], (l) => toggleLabel(l, 'a'));
    const done = updater.update([], (l) => toggleLabel(l, 'b'));
    await tick();
    expect(saves.map((s) => s.labels)).toEqual([['a', 'b']]);
    saves[0]?.done.resolve('only');
    await done;
    expect(saves).toHaveLength(1);
    expect(saved).toEqual(['only']);
  });

  test('toggling a label on and off again ends with the original labels', async () => {
    const { updater, saves } = setup();
    void updater.update(['bug'], (l) => toggleLabel(l, 'ui'));
    await tick();
    const done = updater.update(['bug'], (l) => toggleLabel(l, 'ui'));
    saves[0]?.done.resolve('on');
    await tick();
    saves[1]?.done.resolve('off');
    await done;
    expect(saves.map((s) => s.labels)).toEqual([['bug', 'ui'], ['bug']]);
  });

  test('an edit that changes nothing sends nothing', async () => {
    const { updater, saves, pending } = setup();
    await updater.update(['bug'], (l) => addLabel(l, 'bug'));
    expect(saves).toEqual([]);
    expect(pending).toEqual([]);
  });

  test('after a burst, the next edit starts from the new props', async () => {
    const { updater, saves } = setup();
    const first = updater.update(['bug'], (l) => toggleLabel(l, 'ui'));
    await tick();
    saves[0]?.done.resolve('one');
    await first;
    // Someone else removed `bug` meanwhile; the props show it
    const second = updater.update(['ui'], (l) => toggleLabel(l, 'docs'));
    await tick();
    expect(saves[1]?.labels).toEqual(['ui', 'docs']);
    saves[1]?.done.resolve('two');
    await second;
  });

  test('a failed save drops the pending labels and reports the error', async () => {
    const { updater, saves, pending, saved, errors } = setup();
    void updater.update(['bug'], (l) => toggleLabel(l, 'ui'));
    await tick();
    const done = updater.update(['bug'], (l) => toggleLabel(l, 'docs'));
    const boom = new Error('boom');
    saves[0]?.done.reject(boom);
    await done;
    expect(errors).toEqual([boom]);
    // The queued edit was part of the failed burst, so it is not sent
    expect(saves).toHaveLength(1);
    expect(saved).toEqual([]);
    expect(pending.at(-1)).toBeNull();
  });
});
