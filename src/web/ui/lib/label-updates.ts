/**
 * Label edits from the detail view's metadata panel. Each edit sends the
 * full label list. Without care, two quick toggles both start from the same
 * (stale) props, and the second PATCH undoes the first. So the panel keeps
 * the pending labels locally, applies each edit to them, and sends the
 * PATCHes one at a time.
 */

/** `labels` with `label` removed if present, else added at the end. */
export function toggleLabel(
  labels: readonly string[],
  label: string,
): string[] {
  return labels.includes(label)
    ? labels.filter((l) => l !== label)
    : [...labels, label];
}

/** `labels` with `label` added at the end, if it is not there yet. */
export function addLabel(labels: readonly string[], label: string): string[] {
  return labels.includes(label) ? [...labels] : [...labels, label];
}

/** Whether two label lists are equal (same labels, same order). */
export function sameLabels(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return a.length === b.length && a.every((l, i) => l === b[i]);
}

export interface LabelUpdaterOptions<R> {
  /** Send the full label list (one call at a time). */
  save: (labels: string[]) => Promise<R>;
  /** Labels to show while saves are pending, or `null` to show the props. */
  onPending: (labels: string[] | null) => void;
  /** The result of the last save, when no more saves are queued. */
  onSaved: (result: R) => void;
  /** A save failed. The pending labels are dropped. */
  onError: (error: unknown) => void;
}

export interface LabelUpdater {
  /**
   * Apply `change` to the pending labels (or to `current`, the labels from
   * the props, if nothing is pending) and queue a save. Resolves when the
   * queue is empty. Never rejects.
   */
  update(
    current: readonly string[],
    change: (labels: readonly string[]) => string[],
  ): Promise<void>;
}

export function createLabelUpdater<R>({
  save,
  onPending,
  onSaved,
  onError,
}: LabelUpdaterOptions<R>): LabelUpdater {
  // Labels the user wants, not yet confirmed by the server
  let pending: string[] | null = null;
  // Labels of the last save in this burst (to skip a duplicate save)
  let sent: string[] | null = null;
  let last: { result: R } | null = null;
  let queued = 0;
  let queue: Promise<void> = Promise.resolve();

  async function run(): Promise<void> {
    try {
      // A later edit can change `pending` before this job runs. Then this
      // job sends the newest labels, and the later job has nothing to do.
      const labels = pending;
      if (labels && !(sent && sameLabels(labels, sent))) {
        sent = labels;
        last = { result: await save(labels) };
      }
    } catch (e) {
      pending = null;
      sent = null;
      onPending(null);
      onError(e);
    } finally {
      queued--;
      if (queued === 0) {
        const done = last;
        pending = null;
        sent = null;
        last = null;
        // Give the result first, so the props are new when the pending
        // labels go away.
        if (done) onSaved(done.result);
        onPending(null);
      }
    }
  }

  return {
    update(current, change) {
      const base = pending ?? [...current];
      const next = change(base);
      if (sameLabels(next, base)) return queue;
      pending = next;
      onPending(next);
      queued++;
      queue = queue.then(run);
      return queue;
    },
  };
}
