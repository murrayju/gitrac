import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseIssueFile } from '../core/issue.ts';
import { type IssueQuery, includesClosed, queryIssues } from '../core/query.ts';
import { parseIssueId } from '../core/slug.ts';
import type { Config, Issue } from '../core/types.ts';
import { listClosedIssueFiles, listIssueFiles } from '../fs/issue-store.ts';

export interface IssueListing {
  /** Matching issues, filtered and sorted per the query. */
  issues: Issue[];
  /**
   * Repo-relative paths of issue files that couldn't be read or parsed, or
   * are malformed (see `parseIssueFile`).
   */
  unreadable: string[];
}

async function loadDir(
  dir: string,
  subdir: string[],
  files: string[],
  unreadable: string[],
): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const file of files) {
    const rel = join('.issues', ...subdir, file);
    try {
      const content = await readFile(join(dir, rel), 'utf-8');
      // Malformed files (e.g. no frontmatter -> id NaN) count as unreadable.
      const id = parseIssueId(file) ?? Number.NaN;
      issues.push(parseIssueFile(content, { id, path: rel }));
    } catch {
      unreadable.push(rel);
    }
  }
  return issues;
}

/**
 * List issues matching `query` (read-only; no lock). Loads `.issues/` and,
 * only when the query can match closed issues, `.issues/closed/`; then
 * filters and sorts with {@link queryIssues}. Used by both `gitrac ls` and
 * `GET /api/issues`. Unreadable files are skipped and reported.
 */
export async function listIssues(
  dir: string,
  query: IssueQuery,
  config: Pick<Config, 'assignees'>,
): Promise<IssueListing> {
  const unreadable: string[] = [];
  const withClosed = includesClosed(query);
  const [openFiles, closedFiles] = await Promise.all([
    listIssueFiles(dir),
    withClosed ? listClosedIssueFiles(dir) : Promise.resolve([]),
  ]);
  const [open, closed] = await Promise.all([
    loadDir(dir, [], openFiles, unreadable),
    loadDir(dir, ['closed'], closedFiles, unreadable),
  ]);
  return {
    issues: queryIssues([...open, ...closed], query, config),
    unreadable,
  };
}
