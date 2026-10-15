import type { Issue } from './types.ts';
import { isClosedStatus } from './types.ts';

/**
 * Issue dependencies (pure; no I/O). Two relations live in the frontmatter of
 * the dependent issue only:
 *
 * - `blockedBy: [ids]` — this issue can't start until those are closed. The
 *   inverse ("blocks") is derived by scanning, never stored, so a link is one
 *   edit to one file and can't go out of sync.
 * - `parent: id` — this issue is a sub-issue of that one (the inverse,
 *   "children", is derived the same way). It is informational: it doesn't
 *   affect readiness.
 *
 * A blocker counts as resolved when it is closed — `done` **or**
 * `cancelled` (a cancelled blocker will never be done, so treating it as
 * blocking would strand its dependents forever; re-plan them instead) — or
 * when it doesn't exist any more (deleted), since nothing can resolve it.
 */

/** The IDs an issue is blocked by (`[]` if none). */
export function blockersOf(issue: Pick<Issue, 'blockedBy'>): number[] {
  return issue.blockedBy ?? [];
}

/** Index issues by ID. */
export function indexIssues(issues: Iterable<Issue>): Map<number, Issue> {
  const byId = new Map<number, Issue>();
  for (const issue of issues) byId.set(issue.id, issue);
  return byId;
}

/** IDs of the issues `id` blocks (those listing it in `blockedBy`), ascending. */
export function blocksOf(id: number, issues: Iterable<Issue>): number[] {
  const ids: number[] = [];
  for (const issue of issues) {
    if (blockersOf(issue).includes(id)) ids.push(issue.id);
  }
  return ids.sort((a, b) => a - b);
}

/** IDs of the sub-issues of `id` (those with `parent: id`), ascending. */
export function childrenOf(id: number, issues: Iterable<Issue>): number[] {
  const ids: number[] = [];
  for (const issue of issues) {
    if (issue.parent === id) ids.push(issue.id);
  }
  return ids.sort((a, b) => a - b);
}

/** Whether blocker `id` is resolved: closed (done/cancelled) or missing. */
export function isBlockerResolved(
  id: number,
  byId: ReadonlyMap<number, Issue>,
): boolean {
  const blocker = byId.get(id);
  return blocker === undefined || isClosedStatus(blocker.status);
}

/** The blockers of `issue` that are still open (existing and not closed). */
export function openBlockers(
  issue: Pick<Issue, 'blockedBy'>,
  byId: ReadonlyMap<number, Issue>,
): number[] {
  return blockersOf(issue).filter((id) => !isBlockerResolved(id, byId));
}

/**
 * The `blockedBy` chain from `from` to `to` (`[from, ..., to]`), following
 * blockers transitively, or null if `to` isn't reachable. Missing issues end
 * a path.
 */
function blockerPath(
  from: number,
  to: number,
  byId: ReadonlyMap<number, Issue>,
): number[] | null {
  const seen = new Set<number>();
  const walk = (id: number): number[] | null => {
    if (id === to) return [id];
    if (seen.has(id)) return null;
    seen.add(id);
    const issue = byId.get(id);
    if (!issue) return null;
    for (const next of blockersOf(issue)) {
      const rest = walk(next);
      if (rest) return [id, ...rest];
    }
    return null;
  };
  return walk(from);
}

/** The parent chain from `from` up to `to` (`[from, ..., to]`), or null. */
function parentPath(
  from: number,
  to: number,
  byId: ReadonlyMap<number, Issue>,
): number[] | null {
  const path: number[] = [];
  const seen = new Set<number>();
  let id: number | undefined = from;
  while (id !== undefined && !seen.has(id)) {
    path.push(id);
    if (id === to) return path;
    seen.add(id);
    id = byId.get(id)?.parent;
  }
  return null;
}

const chain = (ids: number[]): string => ids.map((i) => `#${i}`).join(' → ');

/** Links to add to an issue. */
export interface LinkChanges {
  /** Issues to add to `blockedBy`. */
  blockedBy?: number[];
  /** The new parent. */
  parent?: number;
}

/**
 * Check links to add to issue `id` against the other issues (`byId` must
 * contain every issue, open and closed). Returns error messages (empty =
 * valid):
 *
 * - an issue can't block itself or be its own parent;
 * - every target must exist;
 * - a new `blockedBy` edge must not close a cycle (`#a` blocked by `#b`
 *   while `#b` is, transitively, blocked by `#a`);
 * - a new parent must not make the issue its own ancestor.
 */
export function validateLinks(
  id: number,
  changes: LinkChanges,
  byId: ReadonlyMap<number, Issue>,
): string[] {
  const errors: string[] = [];
  for (const blocker of changes.blockedBy ?? []) {
    if (blocker === id) {
      errors.push(`Issue #${id} can't be blocked by itself`);
    } else if (!byId.has(blocker)) {
      errors.push(`Issue #${blocker} not found (blocked-by of #${id})`);
    } else {
      const path = blockerPath(blocker, id, byId);
      if (path) {
        errors.push(
          `#${id} blocked by #${blocker} would create a dependency cycle (${chain([id, ...path])})`,
        );
      }
    }
  }
  const { parent } = changes;
  if (parent !== undefined) {
    if (parent === id) {
      errors.push(`Issue #${id} can't be its own parent`);
    } else if (!byId.has(parent)) {
      errors.push(`Issue #${parent} not found (parent of #${id})`);
    } else {
      const path = parentPath(parent, id, byId);
      if (path) {
        errors.push(
          `Parent #${parent} would create a parent cycle (${chain([id, ...path])})`,
        );
      }
    }
  }
  return errors;
}

/** Links to remove from an issue. */
export interface UnlinkChanges {
  /** Issues to remove from `blockedBy`. */
  blockedBy?: number[];
  /** Clear the parent. */
  parent?: boolean;
}

/** One issue ID (number or `"#7"`/`"7"` string), or undefined if invalid. */
function idValue(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value === 'string' && /^\s*#?\d+\s*$/.test(value)) {
    const id = Number.parseInt(value.trim().replace(/^#/, ''), 10);
    return id > 0 ? id : undefined;
  }
  return undefined;
}

/**
 * Parse an untrusted `blockedBy` value: one ID or an array of IDs (numbers,
 * or strings like `"7"` / `"#7"`). Returns the IDs, or an error message.
 */
function idList(value: unknown, field: string): number[] | string {
  const items = Array.isArray(value) ? value : [value];
  const ids = items.map(idValue);
  if (items.length === 0 || ids.some((id) => id === undefined)) {
    return `Invalid ${field}: must be an issue ID or a non-empty list of issue IDs`;
  }
  return ids as number[];
}

export type ParsedLinks<T> =
  | { valid: true; values: T; errors: [] }
  | { valid: false; errors: string[] };

function asObject(input: unknown): Record<string, unknown> | null {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

/**
 * Validate the shape of link input from the CLI or a JSON body
 * (`{ blockedBy?: id | id[], parent?: id }`); at least one is required.
 * Whether the targets exist / form cycles is {@link validateLinks}' job.
 */
export function parseLinkChanges(input: unknown): ParsedLinks<LinkChanges> {
  const raw = asObject(input);
  if (!raw)
    return { valid: false, errors: ['Request body must be a JSON object'] };
  const errors: string[] = [];
  const values: LinkChanges = {};
  if (raw.blockedBy !== undefined) {
    const ids = idList(raw.blockedBy, 'blockedBy');
    if (typeof ids === 'string') errors.push(ids);
    else values.blockedBy = ids;
  }
  if (raw.parent !== undefined) {
    const id = idValue(raw.parent);
    if (id === undefined) errors.push('Invalid parent: must be an issue ID');
    else values.parent = id;
  }
  if (errors.length === 0 && !values.blockedBy && values.parent === undefined) {
    errors.push('Nothing to link: give blockedBy and/or parent');
  }
  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, values, errors: [] };
}

/**
 * Validate the shape of unlink input (`{ blockedBy?: id | id[], parent?:
 * true }`); at least one is required.
 */
export function parseUnlinkChanges(input: unknown): ParsedLinks<UnlinkChanges> {
  const raw = asObject(input);
  if (!raw)
    return { valid: false, errors: ['Request body must be a JSON object'] };
  const errors: string[] = [];
  const values: UnlinkChanges = {};
  if (raw.blockedBy !== undefined) {
    const ids = idList(raw.blockedBy, 'blockedBy');
    if (typeof ids === 'string') errors.push(ids);
    else values.blockedBy = ids;
  }
  if (raw.parent !== undefined) {
    if (typeof raw.parent !== 'boolean') {
      errors.push('Invalid parent: must be true (to clear the parent)');
    } else if (raw.parent) {
      values.parent = true;
    }
  }
  if (errors.length === 0 && !values.blockedBy && !values.parent) {
    errors.push('Nothing to unlink: give blockedBy and/or parent');
  }
  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, values, errors: [] };
}

/** A linked issue, as shown on the detail view / `show`. */
export interface IssueRef {
  id: number;
  /** '' if the issue doesn't exist (e.g. deleted). */
  title: string;
  /** Null if the issue doesn't exist. */
  status: Issue['status'] | null;
  /** Whether the linked issue is closed (done/cancelled) or missing. */
  resolved: boolean;
}

/** Every relation of one issue, with the linked issues' titles/statuses. */
export interface IssueDependencies {
  parent: IssueRef | null;
  /** Sub-issues (`parent: <this>`). */
  children: IssueRef[];
  blockedBy: IssueRef[];
  /** Issues listing this one in `blockedBy`. */
  blocks: IssueRef[];
  /** True if any blocker is still open. */
  blocked: boolean;
}

function issueRef(id: number, byId: ReadonlyMap<number, Issue>): IssueRef {
  const issue = byId.get(id);
  return issue
    ? {
        id,
        title: issue.title,
        status: issue.status,
        resolved: isClosedStatus(issue.status),
      }
    : { id, title: '', status: null, resolved: true };
}

/** Resolve an issue's links (and derived inverses) against all issues. */
export function describeDependencies(
  issue: Issue,
  byId: ReadonlyMap<number, Issue>,
): IssueDependencies {
  const all = [...byId.values()];
  const blockedBy = blockersOf(issue).map((id) => issueRef(id, byId));
  return {
    parent: issue.parent === undefined ? null : issueRef(issue.parent, byId),
    children: childrenOf(issue.id, all).map((id) => issueRef(id, byId)),
    blockedBy,
    blocks: blocksOf(issue.id, all).map((id) => issueRef(id, byId)),
    blocked: blockedBy.some((ref) => !ref.resolved),
  };
}
