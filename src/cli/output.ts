import yaml from 'js-yaml';
import type { IssueDependencies, IssueRef } from '../core/dependencies.ts';
import {
  type ClaimedElsewhere,
  type ClosedElsewhere,
  describeLocation,
  type ElsewhereMarks,
  type FoundElsewhere,
} from '../core/elsewhere.ts';
import type { StaleClaim } from '../core/stale.ts';
import type { Comment, Issue, OutputFormat } from '../core/types.ts';

/**
 * Truncate a string to the given max length, appending ellipsis if needed.
 */
function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return `${str.slice(0, max - 1)}\u2026`;
}

/**
 * Pad a string to the given width (right-padded with spaces).
 */
function pad(str: string, width: number): string {
  return str.padEnd(width);
}

/**
 * Format a date string for human display (YYYY-MM-DD).
 */
function shortDate(iso: string): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

/**
 * The marks of an issue: a claim or close on another branch / worktree (see
 * `elsewhereMarks` in `src/core/elsewhere.ts`), and a stale claim (see
 * `staleClaim` in `src/core/stale.ts`; with `--stale`).
 */
export type IssueMarks = ElsewhereMarks & { staleClaim?: StaleClaim };

/** {@link IssueMarks}, by issue ID. */
export type MarksElsewhere = ReadonlyMap<number, IssueMarks>;

/** `stale claim by Y, last activity <iso>`. */
export function describeStaleClaim(claim: StaleClaim): string {
  return `stale claim by ${claim.assignee}, last activity ${claim.updated}`;
}

/** The {@link IssueMarks} of each ID, from the elsewhere marks and stale claims. */
export function mergeMarks(
  marks: ReadonlyMap<number, ElsewhereMarks>,
  staleClaims: ReadonlyMap<number, StaleClaim>,
): Map<number, IssueMarks> {
  const merged = new Map<number, IssueMarks>(marks);
  for (const [id, staleClaim] of staleClaims) {
    merged.set(id, { ...merged.get(id), staleClaim });
  }
  return merged;
}

/** `claimed on branch X by Y` / `claimed in worktree P (branch X) by Y`. */
export function describeClaimElsewhere(claim: ClaimedElsewhere): string {
  return `claimed ${describeLocation(claim)} by ${claim.assignee}`;
}

/** `closed (done) on branch X` / `closed (done) in worktree P (branch X)`. */
export function describeCloseElsewhere(closed: ClosedElsewhere): string {
  return `closed (${closed.status}) ${describeLocation(closed)}`;
}

/** `only on branch X` / `only in worktree P (branch X)`. */
export function describeFoundElsewhere(found: FoundElsewhere): string {
  return `only ${describeLocation(found)}`;
}

/**
 * The human description of `mark` (a claim or a close elsewhere, or an
 * issue that is only elsewhere), if any.
 */
function describeMark(mark: IssueMarks | undefined): string | undefined {
  if (mark?.claimedElsewhere)
    return describeClaimElsewhere(mark.claimedElsewhere);
  if (mark?.closedElsewhere)
    return describeCloseElsewhere(mark.closedElsewhere);
  if (mark?.foundElsewhere) return describeFoundElsewhere(mark.foundElsewhere);
  return undefined;
}

/**
 * The issue as output by json/yaml: plus `claimedElsewhere`,
 * `closedElsewhere` or `foundElsewhere` when set.
 */
function issueData(issue: Issue, marks?: MarksElsewhere): object {
  const mark = marks?.get(issue.id);
  return mark ? { ...issue, ...mark } : issue;
}

/**
 * Format a list of issues for human-readable table output.
 */
function formatHumanList(issues: Issue[], marks?: MarksElsewhere): string {
  if (issues.length === 0) {
    return 'No issues found.';
  }

  // Wide enough for the longest assignee (usually an email) + 2 spaces.
  const assigneeWidth = Math.max(
    16,
    ...issues.map((i) => (i.assignee || '-').length + 2),
  );

  const header = [
    pad('ID', 6),
    pad('Title', 42),
    pad('Status', 12),
    pad('Priority', 10),
    pad('Assignee', assigneeWidth),
    pad('Updated', 12),
    'Labels',
  ].join('');

  const separator = '-'.repeat(header.length);

  const rows = issues.map((issue) => {
    const mark = describeMark(marks?.get(issue.id));
    const stale = marks?.get(issue.id)?.staleClaim;
    return [
      pad(`#${issue.id}`, 6),
      pad(truncate(issue.title, 40), 42),
      pad(issue.status, 12),
      pad(issue.priority, 10),
      pad(issue.assignee || '-', assigneeWidth),
      pad(shortDate(issue.updated), 12),
      issue.labels.join(', ') || '-',
      mark ? `  [${mark}]` : '',
      stale ? `  [${describeStaleClaim(stale)}]` : '',
    ].join('');
  });

  return [header, separator, ...rows].join('\n');
}

/**
 * Format a single comment for human display.
 */
function formatComment(comment: Comment): string {
  return `--- ${comment.author} (${comment.timestamp}) ---\n${comment.body}`;
}

/**
 * `#3 Title (done)`, `#3 (missing)` for a deleted issue, or `#3 Title (todo,
 * only in worktree P (branch X))` for an issue only elsewhere.
 */
function formatRef(ref: IssueRef): string {
  if (ref.status === null) return `#${ref.id} (missing)`;
  const where = ref.foundElsewhere
    ? `, ${describeFoundElsewhere(ref.foundElsewhere)}`
    : '';
  return `#${ref.id} ${ref.title} (${ref.status}${where})`;
}

/**
 * The dependency lines of the detail view: from the resolved `deps` when
 * given (titles, statuses, derived "blocks" / sub-issues), else just the
 * issue's own `parent` / `blockedBy` IDs. Lines without links are omitted.
 */
function dependencyLines(issue: Issue, deps?: IssueDependencies): string[] {
  const lines: string[] = [];
  const add = (label: string, refs: string[]) => {
    if (refs.length > 0) lines.push(`${label.padEnd(12)}${refs.join(', ')}`);
  };
  if (deps) {
    add('Parent:', deps.parent ? [formatRef(deps.parent)] : []);
    add('Sub-issues:', deps.children.map(formatRef));
    add('Blocked by:', deps.blockedBy.map(formatRef));
    add('Blocks:', deps.blocks.map(formatRef));
  } else {
    add('Parent:', issue.parent === undefined ? [] : [`#${issue.parent}`]);
    add(
      'Blocked by:',
      (issue.blockedBy ?? []).map((id) => `#${id}`),
    );
  }
  return lines;
}

/**
 * Format a single issue for human-readable detail output.
 */
function formatHumanDetail(
  issue: Issue,
  deps?: IssueDependencies,
  mark?: IssueMarks,
): string {
  const where = describeMark(mark);
  const stale = mark?.staleClaim;
  const when =
    mark?.claimedElsewhere?.updated ?? mark?.closedElsewhere?.updated;
  const lines: string[] = [
    `# #${issue.id}: ${issue.title}`,
    '',
    `Status:     ${issue.status}`,
    `Priority:   ${issue.priority}`,
    `Assignee:   ${issue.assignee || '-'}`,
    ...(where ? [`Elsewhere:  ${where}${when ? ` (${when})` : ''}`] : []),
    ...(stale ? [`Stale:      ${describeStaleClaim(stale)}`] : []),
    `Labels:     ${issue.labels.length > 0 ? issue.labels.join(', ') : '-'}`,
    ...dependencyLines(issue, deps),
    `Created:    ${issue.created} by ${issue.createdBy}`,
    `Updated:    ${issue.updated}`,
  ];

  if (issue.description) {
    lines.push('', '## Description', '', issue.description);
  }

  if (issue.comments.length > 0) {
    lines.push('', '## Comments', '');
    for (const comment of issue.comments) {
      lines.push(formatComment(comment), '');
    }
  }

  return lines.join('\n');
}

/**
 * Format a list of issues in the specified output format. `marks` flags
 * issues claimed or closed on another branch or worktree, or only found
 * there (json/yaml: a `claimedElsewhere`, `closedElsewhere` or
 * `foundElsewhere` field).
 */
export function formatIssueList(
  issues: Issue[],
  format: OutputFormat,
  marks?: MarksElsewhere,
): string {
  switch (format) {
    case 'human':
      return formatHumanList(issues, marks);
    case 'json':
      return JSON.stringify(
        issues.map((i) => issueData(i, marks)),
        null,
        2,
      );
    case 'yaml':
      return yaml.dump(
        issues.map((i) => issueData(i, marks)),
        { lineWidth: -1 },
      );
  }
}

/**
 * Format a single issue detail in the specified output format. json/yaml are
 * the issue itself (`parent` / `blockedBy` included when set), plus
 * `claimedElsewhere` or `closedElsewhere` when `mark` says it is claimed or
 * closed on another branch or worktree, or `foundElsewhere` when it is only
 * there. `deps` (resolved links) adds the
 * linked issues to the human output and, in json/yaml, a `dependencies`
 * field (`{ parent, children, blockedBy, blocks, blocked }`).
 */
export function formatIssueDetail(
  issue: Issue,
  format: OutputFormat,
  deps?: IssueDependencies,
  mark?: IssueMarks,
): string {
  const marks = mark ? new Map([[issue.id, mark]]) : undefined;
  const data = deps
    ? { ...issueData(issue, marks), dependencies: deps }
    : issueData(issue, marks);
  switch (format) {
    case 'human':
      return formatHumanDetail(issue, deps, mark);
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'yaml':
      return yaml.dump(data, { lineWidth: -1 });
  }
}
