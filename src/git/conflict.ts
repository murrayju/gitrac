import { parseIssue, serializeIssue } from '../core/issue.ts';
import type { Comment, IssueFrontmatter } from '../core/types.ts';

/**
 * Per-field last-writer-wins merge for issue frontmatter.
 * If both sides changed the same field relative to base, ours wins.
 */
export function mergeIssueFrontmatter(
  ours: IssueFrontmatter,
  theirs: IssueFrontmatter,
  base: IssueFrontmatter,
): IssueFrontmatter {
  const result = { ...ours };
  const fields = [
    'id',
    'title',
    'status',
    'priority',
    'assignee',
    'labels',
    'created',
    'createdBy',
    'updated',
  ] as const;

  for (const field of fields) {
    const baseVal = JSON.stringify(base[field]);
    const oursVal = JSON.stringify(ours[field]);
    const theirsVal = JSON.stringify(theirs[field]);

    if (oursVal === baseVal && theirsVal !== baseVal) {
      // Only theirs changed — take theirs
      (result as Record<string, unknown>)[field] = theirs[field];
    }
    // If ours changed (or both changed), ours wins (already in result)
  }

  return result;
}

/**
 * Union merge of comments, sorted by timestamp, deduped by author+timestamp.
 * When duplicates differ in body, ours wins.
 */
export function mergeComments(ours: Comment[], theirs: Comment[]): Comment[] {
  const seen = new Map<string, Comment>();

  // Add ours first so ours wins on duplicates
  for (const c of ours) {
    const key = `${c.author}|${c.timestamp}`;
    seen.set(key, c);
  }
  for (const c of theirs) {
    const key = `${c.author}|${c.timestamp}`;
    if (!seen.has(key)) {
      seen.set(key, c);
    }
  }

  const merged = [...seen.values()];
  merged.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  return merged;
}

/**
 * Resolve an issue conflict by parsing all three versions,
 * merging frontmatter and comments, and checking description conflicts.
 * Returns null if descriptions conflict (both sides changed differently).
 */
export function resolveIssueConflict(
  oursContent: string,
  theirsContent: string,
  baseContent: string,
): string | null {
  const oursIssue = parseIssue(oursContent);
  const theirsIssue = parseIssue(theirsContent);
  const baseIssue = parseIssue(baseContent);

  // Check description conflicts
  const oursDescChanged = oursIssue.description !== baseIssue.description;
  const theirsDescChanged = theirsIssue.description !== baseIssue.description;
  if (oursDescChanged && theirsDescChanged) {
    if (oursIssue.description !== theirsIssue.description) {
      return null; // Conflicting descriptions
    }
  }

  // Determine merged description
  let description: string;
  if (oursDescChanged) {
    description = oursIssue.description;
  } else if (theirsDescChanged) {
    description = theirsIssue.description;
  } else {
    description = baseIssue.description;
  }

  // Merge frontmatter
  const oursFm: IssueFrontmatter = {
    id: oursIssue.id,
    title: oursIssue.title,
    status: oursIssue.status,
    priority: oursIssue.priority,
    assignee: oursIssue.assignee,
    labels: oursIssue.labels,
    created: oursIssue.created,
    createdBy: oursIssue.createdBy,
    updated: oursIssue.updated,
  };
  const theirsFm: IssueFrontmatter = {
    id: theirsIssue.id,
    title: theirsIssue.title,
    status: theirsIssue.status,
    priority: theirsIssue.priority,
    assignee: theirsIssue.assignee,
    labels: theirsIssue.labels,
    created: theirsIssue.created,
    createdBy: theirsIssue.createdBy,
    updated: theirsIssue.updated,
  };
  const baseFm: IssueFrontmatter = {
    id: baseIssue.id,
    title: baseIssue.title,
    status: baseIssue.status,
    priority: baseIssue.priority,
    assignee: baseIssue.assignee,
    labels: baseIssue.labels,
    created: baseIssue.created,
    createdBy: baseIssue.createdBy,
    updated: baseIssue.updated,
  };

  const mergedFm = mergeIssueFrontmatter(oursFm, theirsFm, baseFm);
  const mergedComments = mergeComments(
    oursIssue.comments,
    theirsIssue.comments,
  );

  const mergedIssue = {
    ...mergedFm,
    description,
    comments: mergedComments,
  };

  return serializeIssue(mergedIssue);
}
