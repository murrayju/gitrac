import { blockersOf } from '../core/dependencies.ts';
import { issueFilename } from '../core/slug.ts';
import type { Issue } from '../core/types.ts';
import { issuePath } from './context.ts';
import { loadAllIssues } from './list.ts';
import { loadStoredIssue, type StoredIssue } from './load.ts';

/** Another issue that links to an issue ID, loaded fresh for rewriting. */
export interface LinkingIssue {
  stored: StoredIssue;
  /** The ID is in its `blockedBy`. */
  blockedBy: boolean;
  /** Its `parent` is the ID. */
  parent: boolean;
}

/** Whether `issue` links to `id` via `blockedBy` / `parent`. */
export function linksTo(
  issue: Issue,
  id: number,
): { blockedBy: boolean; parent: boolean } {
  return {
    blockedBy: blockersOf(issue).includes(id),
    parent: issue.parent === id,
  };
}

/**
 * Every other issue (open or closed; any issue whose own ID is `id` is
 * skipped) whose `blockedBy` or `parent` points at `id`, by ascending ID,
 * each loaded fresh with {@link loadStoredIssue} (callers hold the lock) so
 * it can be rewritten. Unreadable files are skipped (they can't be fixed
 * anyway); a duplicate or malformed file for a linking issue throws, before
 * the caller writes anything.
 */
export async function linkingIssues(
  dir: string,
  id: number,
): Promise<LinkingIssue[]> {
  const { issues } = await loadAllIssues(dir);
  const ids = new Set<number>();
  for (const other of issues) {
    if (other.id === id) continue;
    const links = linksTo(other, id);
    if (links.blockedBy || links.parent) ids.add(other.id);
  }
  const result: LinkingIssue[] = [];
  for (const otherId of [...ids].sort((a, b) => a - b)) {
    const stored = await loadStoredIssue(dir, otherId);
    const links = linksTo(stored.issue, id);
    if (!links.blockedBy && !links.parent) continue;
    result.push({ stored, ...links });
  }
  return result;
}

/**
 * Repo-relative paths a rewrite of `stored` (already changed in memory)
 * touches: the path it will be written to, then the old one if its filename
 * is stale (see `relocateIssue`).
 */
export function rewritePaths(stored: StoredIssue): string[] {
  const newPath = issuePath(
    issueFilename(stored.issue.id, stored.issue.title),
    stored.closed,
  );
  const oldPath = issuePath(stored.filename, stored.closed);
  return newPath === oldPath ? [newPath] : [newPath, oldPath];
}
