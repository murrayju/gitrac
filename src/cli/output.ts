import yaml from 'js-yaml';
import type { IssueDependencies, IssueRef } from '../core/dependencies.ts';
import { type ClaimedElsewhere, describeLocation } from '../core/elsewhere.ts';
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

/** Claims on other branches / worktrees, by issue ID (see `src/core/elsewhere.ts`). */
export type ClaimsElsewhere = ReadonlyMap<number, ClaimedElsewhere>;

/** `claimed on branch X by Y` / `claimed in worktree P (branch X) by Y`. */
export function describeClaimElsewhere(claim: ClaimedElsewhere): string {
  return `claimed ${describeLocation(claim)} by ${claim.assignee}`;
}

/** The issue as output by json/yaml: plus `claimedElsewhere` when set. */
function issueData(issue: Issue, claims?: ClaimsElsewhere): object {
  const claim = claims?.get(issue.id);
  return claim ? { ...issue, claimedElsewhere: claim } : issue;
}

/**
 * Format a list of issues for human-readable table output.
 */
function formatHumanList(issues: Issue[], claims?: ClaimsElsewhere): string {
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
    const claim = claims?.get(issue.id);
    return [
      pad(`#${issue.id}`, 6),
      pad(truncate(issue.title, 40), 42),
      pad(issue.status, 12),
      pad(issue.priority, 10),
      pad(issue.assignee || '-', assigneeWidth),
      pad(shortDate(issue.updated), 12),
      issue.labels.join(', ') || '-',
      claim ? `  [${describeClaimElsewhere(claim)}]` : '',
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

/** `#3 Title (done)`, or `#3 (missing)` for a deleted issue. */
function formatRef(ref: IssueRef): string {
  return ref.status === null
    ? `#${ref.id} (missing)`
    : `#${ref.id} ${ref.title} (${ref.status})`;
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
  claim?: ClaimedElsewhere,
): string {
  const lines: string[] = [
    `# #${issue.id}: ${issue.title}`,
    '',
    `Status:     ${issue.status}`,
    `Priority:   ${issue.priority}`,
    `Assignee:   ${issue.assignee || '-'}`,
    ...(claim
      ? [`Elsewhere:  ${describeClaimElsewhere(claim)} (${claim.updated})`]
      : []),
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
 * Format a list of issues in the specified output format. `claims` marks
 * issues claimed on another branch or worktree (json/yaml: a
 * `claimedElsewhere` field).
 */
export function formatIssueList(
  issues: Issue[],
  format: OutputFormat,
  claims?: ClaimsElsewhere,
): string {
  switch (format) {
    case 'human':
      return formatHumanList(issues, claims);
    case 'json':
      return JSON.stringify(
        issues.map((i) => issueData(i, claims)),
        null,
        2,
      );
    case 'yaml':
      return yaml.dump(
        issues.map((i) => issueData(i, claims)),
        { lineWidth: -1 },
      );
  }
}

/**
 * Format a single issue detail in the specified output format. `deps`
 * (resolved links) enriches the human output only; json/yaml are the issue
 * itself (`parent` / `blockedBy` included when set), plus `claimedElsewhere`
 * when `claim` says it is claimed on another branch or worktree.
 */
export function formatIssueDetail(
  issue: Issue,
  format: OutputFormat,
  deps?: IssueDependencies,
  claim?: ClaimedElsewhere,
): string {
  const claims = claim ? new Map([[issue.id, claim]]) : undefined;
  switch (format) {
    case 'human':
      return formatHumanDetail(issue, deps, claim);
    case 'json':
      return JSON.stringify(issueData(issue, claims), null, 2);
    case 'yaml':
      return yaml.dump(issueData(issue, claims), { lineWidth: -1 });
  }
}
