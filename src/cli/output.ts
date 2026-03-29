import yaml from 'js-yaml';
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
 * Format a list of issues for human-readable table output.
 */
function formatHumanList(issues: Issue[]): string {
  if (issues.length === 0) {
    return 'No issues found.';
  }

  const header = [
    pad('ID', 6),
    pad('Title', 42),
    pad('Status', 12),
    pad('Priority', 10),
    pad('Assignee', 16),
    'Updated',
  ].join('');

  const separator = '-'.repeat(header.length);

  const rows = issues.map((issue) =>
    [
      pad(`#${issue.id}`, 6),
      pad(truncate(issue.title, 40), 42),
      pad(issue.status, 12),
      pad(issue.priority, 10),
      pad(issue.assignee || '-', 16),
      shortDate(issue.updated),
    ].join(''),
  );

  return [header, separator, ...rows].join('\n');
}

/**
 * Format a single comment for human display.
 */
function formatComment(comment: Comment): string {
  return `--- ${comment.author} (${comment.timestamp}) ---\n${comment.body}`;
}

/**
 * Format a single issue for human-readable detail output.
 */
function formatHumanDetail(issue: Issue): string {
  const lines: string[] = [
    `# #${issue.id}: ${issue.title}`,
    '',
    `Status:     ${issue.status}`,
    `Priority:   ${issue.priority}`,
    `Assignee:   ${issue.assignee || '-'}`,
    `Labels:     ${issue.labels.length > 0 ? issue.labels.join(', ') : '-'}`,
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
 * Format a list of issues in the specified output format.
 */
export function formatIssueList(
  issues: Issue[],
  format: OutputFormat,
): string {
  switch (format) {
    case 'human':
      return formatHumanList(issues);
    case 'json':
      return JSON.stringify(issues, null, 2);
    case 'yaml':
      return yaml.dump(issues, { lineWidth: -1 });
  }
}

/**
 * Format a single issue detail in the specified output format.
 */
export function formatIssueDetail(
  issue: Issue,
  format: OutputFormat,
): string {
  switch (format) {
    case 'human':
      return formatHumanDetail(issue);
    case 'json':
      return JSON.stringify(issue, null, 2);
    case 'yaml':
      return yaml.dump(issue, { lineWidth: -1 });
  }
}
