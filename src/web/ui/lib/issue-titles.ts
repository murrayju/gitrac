/**
 * Titles of the issues the UI has already loaded (the list, the open issue,
 * its linked issues), so `#N` links can show a title on hover without
 * fetching anything. Unknown IDs simply have no title.
 */

const titles = new Map<number, string>();
const listeners = new Set<() => void>();

/** Record titles from loaded issues; notifies listeners if any changed. */
export function rememberIssueTitles(
  issues: Iterable<{ id: number; title: string }>,
): void {
  let changed = false;
  for (const { id, title } of issues) {
    // '' = a linked issue that no longer exists
    if (!title) {
      changed = titles.delete(id) || changed;
    } else if (titles.get(id) !== title) {
      titles.set(id, title);
      changed = true;
    }
  }
  if (changed) for (const listener of [...listeners]) listener();
}

/** The loaded title of issue `id`, if any. */
export function issueTitle(id: number): string | undefined {
  return titles.get(id);
}

/** Call `listener` whenever a title changes; returns an unsubscribe. */
export function subscribeIssueTitles(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Forget every title (tests). */
export function clearIssueTitles(): void {
  titles.clear();
}
