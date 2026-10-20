import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  describeDependencies,
  type IssueDependencies,
  indexIssues,
} from '../core/dependencies.ts';
import {
  type ElsewhereMarks,
  elsewhereMarks,
  type IssueOnlyElsewhere,
  type IssueStateElsewhere,
  issuesOnlyElsewhere,
} from '../core/elsewhere.ts';
import { parseIssueFile } from '../core/issue.ts';
import {
  type IssueQuery,
  type QueryConfig,
  queryIssues,
} from '../core/query.ts';
import { parseIssueId } from '../core/slug.ts';
import {
  type StaleClaim,
  type StaleOptions,
  staleClaim,
} from '../core/stale.ts';
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

/** Issue versions found elsewhere, by ID (`issueStatesElsewhere`). */
type States = ReadonlyMap<number, readonly IssueStateElsewhere[]>;

/**
 * List issues matching `query` (read-only; no lock). Loads `.issues/` and
 * `.issues/closed/`, then filters and sorts with {@link queryIssues}. The
 * `status` field decides if an issue is open, not its directory: a merge can
 * leave an open issue in `.issues/closed/` (or a closed one in `.issues/`).
 * `misplaced` gives the paths of such files, so the CLI can warn. The next
 * write of the issue moves its file (see `relocateIssue`). Used by both
 * `gitrac ls` and `GET /api/issues`. Unreadable files are skipped and
 * reported.
 *
 * With `options.elsewhere` (a scan with `withIssues`, maybe cached),
 * `elsewhere` gives the issues that have no file here but exist in another
 * worktree or on another branch (newest version, see `issuesOnlyElsewhere`),
 * filtered and sorted per `query` too. Else it is empty.
 *
 * With `options.stale`, only the issues whose effective state is a stale
 * claim (see `staleClaim` in `src/core/stale.ts`) are listed, and
 * `staleClaims` gives each one's claim. The versions elsewhere for this
 * come from `options.states` (maybe cached), else `options.elsewhere`, else
 * a fresh scan.
 */
export async function listIssues(
  dir: string,
  query: IssueQuery,
  config: QueryConfig & WorkflowConfig,
  options: {
    elsewhere?: States | Promise<States>;
    stale?: StaleOptions;
    states?: States | Promise<States>;
  } = {},
): Promise<
  IssueListing & {
    misplaced: string[];
    elsewhere: IssueOnlyElsewhere[];
    staleClaims: Map<number, StaleClaim>;
  }
> {
  const [{ open, closed, unreadable }, states, staleStates] = await Promise.all(
    [
      loadDirs(dir),
      options.elsewhere,
      options.stale
        ? (options.states ?? options.elsewhere ?? issueStatesElsewhere(dir))
        : undefined,
    ],
  );
  const misplaced = [
    ...open.filter((f) => isClosedStatus(config, f.issue.status)),
    ...closed.filter((f) => !isClosedStatus(config, f.issue.status)),
  ].map((f) => f.path);
  const issues = [...open, ...closed].map((f) => f.issue);
  let listed = queryIssues(issues, query, config);
  let onlyElsewhere = states
    ? queryElsewhere(localIds(issues, unreadable), states, query, config)
    : [];
  const staleClaims = new Map<number, StaleClaim>();
  const stale = options.stale;
  if (stale) {
    listed = listed.filter((issue) => {
      const claim = staleClaim(
        issue,
        config,
        staleStates?.get(issue.id),
        stale,
      );
      if (claim) staleClaims.set(issue.id, claim);
      return claim !== undefined;
    });
    // Their issue is the newest version: judge it alone, at its location.
    onlyElsewhere = onlyElsewhere.filter(({ issue, foundElsewhere }) => {
      const claim = staleClaim(issue, config, undefined, stale);
      if (claim) staleClaims.set(issue.id, { ...claim, ...foundElsewhere });
      return claim !== undefined;
    });
  }
  return {
    issues: listed,
    unreadable,
    misplaced,
    elsewhere: onlyElsewhere,
    staleClaims,
  };
}

/**
 * The IDs that have a file in this working tree: those of `issues` and of
 * the `unreadable` files (by file name), so a broken local file doesn't
 * make its ID look like it's only elsewhere.
 */
export function localIds(
  issues: readonly Issue[],
  unreadable: readonly string[],
): Set<number> {
  const ids = new Set(issues.map((i) => i.id));
  for (const path of unreadable) {
    const id = parseIssueId(basename(path));
    if (id !== null) ids.add(id);
  }
  return ids;
}

/** `issuesOnlyElsewhere`, with their issues filtered and sorted by `query`. */
function queryElsewhere(
  ids: ReadonlySet<number>,
  states: States,
  query: IssueQuery,
  config: QueryConfig,
): IssueOnlyElsewhere[] {
  const found = issuesOnlyElsewhere(ids, states);
  const byId = new Map(found.map((f) => [f.issue.id, f]));
  const issues = queryIssues(
    found.map((f) => f.issue),
    query,
    config,
  );
  return issues.flatMap((issue) => {
    const f = byId.get(issue.id);
    return f ? [f] : [];
  });
}

/**
 * Every issue's versions elsewhere, with their parsed issues unless
 * `withIssues` is false (for `listIssues`' `elsewhere` and `states`
 * options and `marksFromStates`). Read-only; one scan.
 */
export function scanElsewhere(
  dir: string,
  options: { withIssues?: boolean } = {},
): Promise<States> {
  return issueStatesElsewhere(dir, {
    withIssues: options.withIssues ?? true,
  });
}

/**
 * Issue `id` as found in another worktree or on another branch (its newest
 * version and where, from `states`, a scan with `withIssues`), for when this
 * working tree has no file for it; null if there's none. Pure.
 */
export function issueOnlyElsewhereIn(
  id: number,
  states: States,
): IssueOnlyElsewhere | null {
  const list = states.get(id);
  if (!list) return null;
  return issuesOnlyElsewhere(new Set(), new Map([[id, list]]))[0] ?? null;
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
 * The links of `issue` (`describeDependencies`), resolved against the local
 * issues (`listing`, from `loadAllIssues`) and the issues only elsewhere
 * (from `states`, a scan with `withIssues`, maybe cached). So a linked issue
 * that exists only in another worktree or on another branch shows its title,
 * status and location (`foundElsewhere`), and counts as a blocker; one that
 * links to `issue` from there is a sub-issue or "blocks" entry. `issue` may
 * itself be only elsewhere. Pure; used by `gitrac show` and
 * `GET /api/issues/:id/dependencies`.
 */
export function dependenciesWithElsewhere(
  issue: Issue,
  listing: IssueListing,
  states: States,
  config: WorkflowConfig,
): IssueDependencies {
  const byId = indexIssues(listing.issues);
  byId.set(issue.id, issue);
  const ids = localIds(listing.issues, listing.unreadable);
  ids.add(issue.id);
  return describeDependencies(
    issue,
    byId,
    config,
    issuesOnlyElsewhere(ids, states),
  );
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
