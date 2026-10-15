import type { ClaimUser } from './claim.ts';
import { invalidInput } from './errors.ts';
import type { Config, Issue, Priority, Status } from './types.ts';
import {
  isClosedStatus,
  priorityNames,
  type StatusConfig,
  statusNames,
  statusSortOrder,
} from './workflow.ts';

/**
 * Issue list filtering, search and sorting — shared by `gitrac ls` and
 * `GET /api/issues` so both have exactly the same semantics (pure; no I/O).
 *
 * - Every filter accepts several values (comma-separated and/or repeated);
 *   an issue matches a filter if it matches **any** of its values, and must
 *   match **every** filter given.
 * - `status`: configured statuses, or `all`. Without it only open
 *   (non-closed) issues are listed. Status and priority names are matched
 *   case-insensitively (configured names are lowercase).
 * - `assignee`: case-insensitive, by stored value, name or email (names and
 *   emails are linked through `config.assignees`).
 * - `mine`: issues assigned to the given user (their name or email).
 * - `search`: every whitespace-separated term must occur (case-insensitive)
 *   in the title or description.
 */
export interface IssueQuery {
  /** Statuses to include; `undefined` = open issues only. */
  status?: Status[] | 'all';
  priority?: Priority[];
  label?: string[];
  assignee?: string[];
  /** Only issues assigned to this user. */
  mine?: ClaimUser;
  search?: string;
  sort: SortField;
}

export const SORT_FIELDS = [
  'id',
  'priority',
  'status',
  'created',
  'updated',
] as const;
export type SortField = (typeof SORT_FIELDS)[number];

/** The config a query is parsed, filtered and sorted against. */
export type QueryConfig = Pick<Config, 'statuses' | 'priorities' | 'assignees'>;

/** Raw filter input: CLI option strings or (possibly repeated) query params. */
export interface RawIssueQuery {
  status?: string | string[];
  priority?: string | string[];
  label?: string | string[];
  assignee?: string | string[];
  search?: string | string[];
  sort?: string | string[];
}

/** Split comma-separated (and/or repeated) values; trims, drops empties. */
export function splitValues(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/**
 * Parse and validate raw list filters against the config. Unknown statuses,
 * priorities or sort fields are rejected (`invalid_input`); labels and
 * assignees are free-form (no match = empty list).
 */
export function parseIssueQuery(
  raw: RawIssueQuery,
  config: Pick<Config, 'statuses' | 'priorities'>,
  options: { mine?: ClaimUser } = {},
): IssueQuery {
  const errors: string[] = [];
  const knownStatuses = statusNames(config);
  const knownPriorities = priorityNames(config);

  const statuses = splitValues(raw.status).map((s) => s.toLowerCase());
  let status: IssueQuery['status'];
  if (statuses.includes('all')) {
    status = 'all';
  } else if (statuses.length > 0) {
    const bad = statuses.filter((s) => !knownStatuses.includes(s));
    if (bad.length > 0) {
      errors.push(
        `Invalid status "${bad.join(', ')}": must be one of ${[...knownStatuses, 'all'].join(', ')}`,
      );
    }
    status = unique(statuses);
  }

  const priorities = splitValues(raw.priority).map((p) => p.toLowerCase());
  const badPriorities = priorities.filter((p) => !knownPriorities.includes(p));
  if (badPriorities.length > 0) {
    errors.push(
      `Invalid priority "${badPriorities.join(', ')}": must be one of ${knownPriorities.join(', ')}`,
    );
  }

  const sorts = splitValues(raw.sort);
  const sort = (sorts.at(-1) ?? 'id').toLowerCase();
  if (!(SORT_FIELDS as readonly string[]).includes(sort)) {
    errors.push(
      `Invalid sort field "${sort}": must be one of ${SORT_FIELDS.join(', ')}`,
    );
  }

  if (errors.length > 0) throw invalidInput(errors);

  const labels = splitValues(raw.label);
  const assignees = splitValues(raw.assignee);
  const search = (Array.isArray(raw.search) ? raw.search : [raw.search ?? ''])
    .join(' ')
    .trim();

  return {
    status,
    priority: priorities.length > 0 ? unique(priorities) : undefined,
    label: labels.length > 0 ? unique(labels) : undefined,
    assignee: assignees.length > 0 ? unique(assignees) : undefined,
    mine: options.mine,
    search: search || undefined,
    sort: sort as SortField,
  };
}

/**
 * Whether the query can match issues in `.issues/closed/` (so the caller
 * must load them): `status=all`, or any closed status.
 */
export function includesClosed(
  query: Pick<IssueQuery, 'status'>,
  config: StatusConfig,
): boolean {
  if (query.status === 'all') return true;
  return (query.status ?? []).some((s) => isClosedStatus(config, s));
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Every lower-cased identity a set of assignee names/emails stands for: the
 * values themselves plus the name and email of each configured assignee
 * matching one of them (so `Justin Murray` also finds `justin@…`).
 */
function assigneeAliases(
  values: string[],
  assignees: Config['assignees'],
): Set<string> {
  const wanted = new Set(values.map(norm).filter((v) => v !== ''));
  for (const a of assignees) {
    if (wanted.has(norm(a.name)) || wanted.has(norm(a.email))) {
      if (norm(a.name)) wanted.add(norm(a.name));
      if (norm(a.email)) wanted.add(norm(a.email));
    }
  }
  return wanted;
}

function matchesSearch(issue: Issue, search: string): boolean {
  const haystack = `${issue.title}\n${issue.description}`.toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t !== '')
    .every((term) => haystack.includes(term));
}

/** Apply the query's filters (not its sort) to `issues`. */
export function filterIssues(
  issues: Issue[],
  query: Omit<IssueQuery, 'sort'>,
  config: Pick<Config, 'statuses' | 'assignees'>,
): Issue[] {
  const { status, priority, label, assignee, mine, search } = query;
  const assigneeSet = assignee && assigneeAliases(assignee, config.assignees);
  const mineSet =
    mine && assigneeAliases([mine.name, mine.email], config.assignees);
  return issues.filter((issue) => {
    if (status === undefined) {
      if (isClosedStatus(config, issue.status)) return false;
    } else if (status !== 'all' && !status.includes(issue.status)) {
      return false;
    }
    if (priority && !priority.includes(issue.priority)) return false;
    if (label && !issue.labels.some((l) => label.includes(l))) return false;
    if (assigneeSet && !assigneeSet.has(norm(issue.assignee))) return false;
    if (mineSet && !mineSet.has(norm(issue.assignee))) return false;
    if (search && !matchesSearch(issue, search)) return false;
    return true;
  });
}

function rank<T>(order: T[], value: T): number {
  const i = order.indexOf(value);
  return i === -1 ? order.length : i;
}

function time(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Sort issues (returns a new array). `id` ascending; `priority` in configured
 * order (most urgent first); `status` open statuses furthest along the
 * workflow first, then closed ones in configured order
 * (`statusSortOrder`; built-in: in_progress, todo, backlog, done,
 * cancelled); `created` / `updated` newest first. Unconfigured statuses and
 * priorities sort last. Ties are broken by ID ascending.
 */
export function sortIssues(
  issues: Issue[],
  sort: SortField,
  config: Pick<Config, 'statuses' | 'priorities'>,
): Issue[] {
  const compare: (a: Issue, b: Issue) => number = (() => {
    switch (sort) {
      case 'priority': {
        const order: Priority[] = priorityNames(config);
        return (a: Issue, b: Issue) =>
          rank(order, a.priority) - rank(order, b.priority);
      }
      case 'status': {
        const order: Status[] = statusSortOrder(config);
        return (a: Issue, b: Issue) =>
          rank(order, a.status) - rank(order, b.status);
      }
      case 'created':
        return (a: Issue, b: Issue) => time(b.created) - time(a.created);
      case 'updated':
        return (a: Issue, b: Issue) => time(b.updated) - time(a.updated);
      default:
        return () => 0;
    }
  })();
  return [...issues].sort((a, b) => compare(a, b) || a.id - b.id);
}

/** Filter, then sort. */
export function queryIssues(
  issues: Issue[],
  query: IssueQuery,
  config: QueryConfig,
): Issue[] {
  return sortIssues(filterIssues(issues, query, config), query.sort, config);
}
