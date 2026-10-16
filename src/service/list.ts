import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type ElsewhereMarks,
  elsewhereMarks,
  type IssueStateElsewhere,
} from '../core/elsewhere.ts';
import { parseIssueFile } from '../core/issue.ts';
import {
  type IssueQuery,
  type QueryConfig,
  queryIssues,
} from '../core/query.ts';
import { parseIssueId } from '../core/slug.ts';
import type { Issue } from '../core/types.ts';
import { isClosedStatus, type WorkflowConfig } from '../core/workflow.ts';
import { listClosedIssueFiles, listIssueFiles } from '../fs/issue-store.ts';
import { issueStatesElsewhere } from '../git/elsewhere.ts';

export interface IssueListing {
  /** Matching issues, filtered and sorted per the query. */
  issues: Issue[];
  /**
   * Repo-relative paths of issue files that couldn't be read or parsed, or
   * are malformed (see `parseIssueFile`).
   */
  unreadable: string[];
}

/** An issue file and where it is. */
interface LoadedFile {
  issue: Issue;
  /** Repo-relative path. */
  path: string;
}

async function loadDir(
  dir: string,
  subdir: string[],
  files: string[],
  unreadable: string[],
): Promise<LoadedFile[]> {
  const loaded: LoadedFile[] = [];
  for (const file of files) {
    const rel = join('.issues', ...subdir, file);
    try {
      const content = await readFile(join(dir, rel), 'utf-8');
      // Malformed files (e.g. no frontmatter -> id NaN) count as unreadable.
      const id = parseIssueId(file) ?? Number.NaN;
      loaded.push({
        issue: parseIssueFile(content, { id, path: rel }),
        path: rel,
      });
    } catch {
      unreadable.push(rel);
    }
  }
  return loaded;
}

/** Load `.issues/` and `.issues/closed/`. */
async function loadDirs(dir: string): Promise<{
  open: LoadedFile[];
  closed: LoadedFile[];
  unreadable: string[];
}> {
  const unreadable: string[] = [];
  const [openFiles, closedFiles] = await Promise.all([
    listIssueFiles(dir),
    listClosedIssueFiles(dir),
  ]);
  const [open, closed] = await Promise.all([
    loadDir(dir, [], openFiles, unreadable),
    loadDir(dir, ['closed'], closedFiles, unreadable),
  ]);
  return { open, closed, unreadable };
}

/**
 * List issues matching `query` (read-only; no lock). Loads `.issues/` and
 * `.issues/closed/`, then filters and sorts with {@link queryIssues}. The
 * `status` field decides if an issue is open, not its directory: a merge can
 * leave an open issue in `.issues/closed/` (or a closed one in `.issues/`).
 * `misplaced` gives the paths of such files, so the CLI can warn. The next
 * write of the issue moves its file (see `relocateIssue`). Used by both
 * `gitrac ls` and `GET /api/issues`. Unreadable files are skipped and
 * reported.
 */
export async function listIssues(
  dir: string,
  query: IssueQuery,
  config: QueryConfig,
): Promise<IssueListing & { misplaced: string[] }> {
  const { open, closed, unreadable } = await loadDirs(dir);
  const misplaced = [
    ...open.filter((f) => isClosedStatus(config, f.issue.status)),
    ...closed.filter((f) => !isClosedStatus(config, f.issue.status)),
  ].map((f) => f.path);
  const issues = [...open, ...closed].map((f) => f.issue);
  return { issues: queryIssues(issues, query, config), unreadable, misplaced };
}

/**
 * Every issue, open and closed (read-only; no lock unless the caller holds
 * it). Unreadable files are skipped and reported.
 */
export async function loadAllIssues(dir: string): Promise<IssueListing> {
  const { open, closed, unreadable } = await loadDirs(dir);
  return {
    issues: [...open, ...closed].map((f) => f.issue),
    unreadable,
  };
}

/**
 * Which of `issues` are claimed or closed on another branch or in another
 * worktree (their newest version is a claim or a close there; see
 * `elsewhereMarks` in `src/core/elsewhere.ts`), by ID, given the versions
 * found elsewhere (`issueStatesElsewhere`, possibly cached; extra IDs are
 * ignored). Pure.
 */
export function marksFromStates(
  issues: readonly Issue[],
  config: WorkflowConfig,
  states: ReadonlyMap<number, readonly IssueStateElsewhere[]>,
): Map<number, ElsewhereMarks> {
  const marks = new Map<number, ElsewhereMarks>();
  for (const issue of issues) {
    const mark = elsewhereMarks(issue, config, states.get(issue.id));
    if (mark) marks.set(issue.id, mark);
  }
  return marks;
}

/**
 * Which of `issues` are claimed or closed on another branch or in another
 * worktree, by ID ({@link marksFromStates}). Read-only; one scan of the
 * repository's refs and worktrees.
 */
export async function findMarksElsewhere(
  dir: string,
  issues: readonly Issue[],
  config: WorkflowConfig,
): Promise<Map<number, ElsewhereMarks>> {
  if (issues.length === 0) return new Map();
  const states = await issueStatesElsewhere(dir, {
    ids: issues.map((i) => i.id),
  });
  return marksFromStates(issues, config, states);
}
