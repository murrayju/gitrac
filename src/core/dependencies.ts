import type { FoundElsewhere, IssueOnlyElsewhere } from './elsewhere.ts';
import { type IssueRelationship, LinkGraph } from './links.ts';
import type { Issue } from './types.ts';
import { isClosedStatus, type StatusConfig } from './workflow.ts';

/**
 * Issue dependencies (pure; no I/O). Relations between issues are `links`
 * of type `issue` (see `src/core/links.ts`). An issue stores only its own
 * side of a relation (e.g. `blockedBy: 3` on #5, or `blocks: 5` on #3: both
 * mean that #3 blocks #5); the other side is derived from every issue's
 * links ({@link LinkGraph}), so a link is one edit to one file.
 *
 * - blocks / blockedBy: the blocked issue can't start until the blocker is
 *   closed.
 * - parent / child: sub-issues. Informational: it doesn't affect readiness.
 * - duplicateOf / duplicatedBy: closed as a duplicate. Informational.
 * - related: informational.
 *
 * A blocker counts as resolved when it is in any closed status — e.g. `done`
 * **or** `cancelled` (a cancelled blocker will never be done, so treating it
 * as blocking would strand its dependents forever; re-plan them instead) — or
 * when it doesn't exist any more (deleted), since nothing can resolve it.
 *
 * A blocker that has no file here but exists in another worktree or on
 * another branch (see `issuesOnlyElsewhere` in `src/core/elsewhere.ts`) is
 * not resolved, whatever its status there: its work is not here yet. Callers
 * pass these issues (or their IDs) in as data.
 */

/** Index issues by ID. */
export function indexIssues(issues: Iterable<Issue>): Map<number, Issue> {
  const byId = new Map<number, Issue>();
  for (const issue of issues) byId.set(issue.id, issue);
  return byId;
}

/**
 * Whether blocker `id` is resolved: in a closed status, or missing. A
 * blocker in `onlyElsewhere` (IDs of issues that have no file here but exist
 * elsewhere) is never resolved.
 */
export function isBlockerResolved(
  id: number,
  byId: ReadonlyMap<number, Issue>,
  config: StatusConfig,
  onlyElsewhere: ReadonlySet<number> = new Set(),
): boolean {
  const blocker = byId.get(id);
  if (blocker === undefined) return !onlyElsewhere.has(id);
  return isClosedStatus(config, blocker.status);
}

/**
 * The blockers of issue `id` (from `graph`) that are still open: existing
 * here and not closed, or only elsewhere (`onlyElsewhere`, in any status).
 */
export function openBlockers(
  id: number,
  graph: LinkGraph,
  byId: ReadonlyMap<number, Issue>,
  config: StatusConfig,
  onlyElsewhere: ReadonlySet<number> = new Set(),
): number[] {
  return graph
    .blockers(id)
    .filter((b) => !isBlockerResolved(b, byId, config, onlyElsewhere));
}

/** A linked issue, as shown on the detail view / `show`. */
export interface IssueRef {
  id: number;
  /** '' if the issue doesn't exist (e.g. deleted). */
  title: string;
  /** Null if the issue doesn't exist. */
  status: Issue['status'] | null;
  /**
   * Whether the linked issue is in a closed status, or missing. False for an
   * issue only elsewhere (`foundElsewhere`), in any status: its work is not
   * here yet.
   */
  resolved: boolean;
  /**
   * Set when the issue has no file here but exists in another worktree or
   * on another branch: where its newest version is. `title` and `status`
   * are those of that version.
   */
  foundElsewhere?: FoundElsewhere;
}

/** Every relation of one issue, with the linked issues' titles/statuses. */
export interface IssueDependencies {
  /** The parent (the first one, if a merge left several). */
  parent: IssueRef | null;
  /** Sub-issues. */
  children: IssueRef[];
  blockedBy: IssueRef[];
  /** Issues this one blocks. */
  blocks: IssueRef[];
  /** The issue this one duplicates (the first one, if several). */
  duplicateOf: IssueRef | null;
  /** Issues that are duplicates of this one. */
  duplicates: IssueRef[];
  related: IssueRef[];
  /** True if any blocker is still open. */
  blocked: boolean;
}

function issueRef(
  id: number,
  byId: ReadonlyMap<number, Issue>,
  elsewhere: ReadonlyMap<number, IssueOnlyElsewhere>,
  config: StatusConfig,
): IssueRef {
  const issue = byId.get(id);
  if (issue) {
    return {
      id,
      title: issue.title,
      status: issue.status,
      resolved: isClosedStatus(config, issue.status),
    };
  }
  const found = elsewhere.get(id);
  if (found) {
    return {
      id,
      title: found.issue.title,
      status: found.issue.status,
      resolved: false,
      foundElsewhere: found.foundElsewhere,
    };
  }
  return { id, title: '', status: null, resolved: true };
}

/**
 * Resolve an issue's relations against all issues: the local ones (`byId`),
 * then the ones only elsewhere (`elsewhere`, see `issuesOnlyElsewhere`). The
 * relations come from the links of all of them, so they include the links
 * that other issues store (e.g. a sub-issue an agent filed in its worktree
 * with `parent: <this>`). `elsewhere` must not contain IDs in `byId`.
 */
export function describeDependencies(
  issue: Issue,
  byId: ReadonlyMap<number, Issue>,
  config: StatusConfig,
  elsewhere: readonly IssueOnlyElsewhere[] = [],
): IssueDependencies {
  const others = new Map(
    elsewhere
      .filter((f) => !byId.has(f.issue.id))
      .map((f) => [f.issue.id, f] as const),
  );
  const graph = new LinkGraph([
    ...[...byId.values()].filter((i) => i.id !== issue.id),
    issue,
    ...[...others.values()].map((f) => f.issue),
  ]);
  const ref = (id: number) => issueRef(id, byId, others, config);
  const { id } = issue;
  const parent = graph.parents(id)[0];
  const original = graph.originals(id)[0];
  const blockedBy = graph.blockers(id).map(ref);
  return {
    parent: parent === undefined ? null : ref(parent),
    children: graph.children(id).map(ref),
    blockedBy,
    blocks: graph.blocked(id).map(ref),
    duplicateOf: original === undefined ? null : ref(original),
    duplicates: graph.duplicates(id).map(ref),
    related: graph.related(id).map(ref),
    blocked: blockedBy.some((r) => !r.resolved),
  };
}

/**
 * The resolved issues of `deps` per relationship, as this issue sees them
 * (`parent`: its parent, `child`: its sub-issues, ...).
 */
export function refsByRelationship(
  deps: IssueDependencies,
): Record<IssueRelationship, IssueRef[]> {
  return {
    parent: deps.parent ? [deps.parent] : [],
    child: deps.children,
    blockedBy: deps.blockedBy,
    blocks: deps.blocks,
    duplicateOf: deps.duplicateOf ? [deps.duplicateOf] : [],
    duplicatedBy: deps.duplicates,
    related: deps.related,
  };
}
