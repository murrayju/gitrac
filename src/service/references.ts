import {
  type IssueRelationship,
  issueLinksOf,
  type Link,
} from '../core/links.ts';
import { issueFilename } from '../core/slug.ts';
import type { Issue } from '../core/types.ts';
import { isClosedStatus, type StatusConfig } from '../core/workflow.ts';
import { issuePath } from './context.ts';
import { loadAllIssues } from './list.ts';
import { loadStoredIssue, type StoredIssue } from './load.ts';

/** Another issue that links to an issue ID, loaded fresh for rewriting. */
export interface LinkingIssue {
  stored: StoredIssue;
  /** The relationships of its links to the ID (in its `links`). */
  relationships: IssueRelationship[];
}

/** The relationships of the links that `issue` stores to issue `id`. */
export function linksTo(
  issue: Pick<Issue, 'links'>,
  id: number,
): IssueRelationship[] {
  return issueLinksOf(issue.links)
    .filter((link) => link.id === id)
    .map((link) => link.relationship);
}

/**
 * `links` with every issue link to `id` given to `rewrite`: it returns the
 * link to keep instead (e.g. with a new ID), or null to drop it.
 */
export function rewriteLinksTo(
  links: readonly Link[] | undefined,
  id: number,
  rewrite: (relationship: IssueRelationship) => Link | null,
): Link[] {
  return (links ?? []).flatMap((link) => {
    const [issueLink] = issueLinksOf([link]);
    if (!issueLink || issueLink.id !== id) return [link];
    const kept = rewrite(issueLink.relationship);
    return kept ? [kept] : [];
  });
}

/**
 * Every other issue (open or closed; any issue whose own ID is `id` is
 * skipped) that stores a link to `id`, by ascending ID, each loaded fresh
 * with {@link loadStoredIssue} (callers hold the lock) so it can be
 * rewritten. Unreadable files are skipped (they can't be fixed anyway); a
 * duplicate or malformed file for a linking issue throws, before the caller
 * writes anything.
 */
export async function linkingIssues(
  dir: string,
  id: number,
): Promise<LinkingIssue[]> {
  const { issues } = await loadAllIssues(dir);
  const ids = new Set<number>();
  for (const other of issues) {
    if (other.id !== id && linksTo(other, id).length > 0) ids.add(other.id);
  }
  const result: LinkingIssue[] = [];
  for (const otherId of [...ids].sort((a, b) => a - b)) {
    const stored = await loadStoredIssue(dir, otherId);
    const relationships = linksTo(stored.issue, id);
    if (relationships.length === 0) continue;
    result.push({ stored, relationships });
  }
  return result;
}

/**
 * Repo-relative paths a rewrite of `stored` (already changed in memory)
 * touches: the path it will be written to (in the directory its status
 * requires), then the old one if its filename or directory is stale (see
 * `relocateIssue`).
 */
export function rewritePaths(
  stored: StoredIssue,
  config: StatusConfig,
): string[] {
  const newPath = issuePath(
    issueFilename(stored.issue.id, stored.issue.title),
    isClosedStatus(config, stored.issue.status),
  );
  const oldPath = issuePath(stored.filename, stored.closed);
  return newPath === oldPath ? [newPath] : [newPath, oldPath];
}
