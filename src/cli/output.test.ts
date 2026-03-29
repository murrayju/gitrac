import { describe, expect, test } from 'bun:test';
import type { Issue } from '../core/types.ts';
import { formatIssueDetail, formatIssueList } from './output.ts';

const SAMPLE_ISSUE: Issue = {
  id: 1,
  title: 'Fix Login Timeout',
  status: 'in_progress',
  priority: 'high',
  assignee: 'alice',
  labels: ['bug', 'urgent'],
  created: '2024-01-15T10:00:00Z',
  createdBy: 'bob',
  updated: '2024-01-15T12:00:00Z',
  description: 'Users are experiencing timeouts.',
  comments: [
    {
      author: 'Alice',
      timestamp: '2024-01-15T11:00:00Z',
      body: 'I can reproduce this.',
    },
  ],
};

const SAMPLE_ISSUE_2: Issue = {
  id: 2,
  title: 'Add dark mode support for the entire application UI',
  status: 'backlog',
  priority: 'medium',
  assignee: '',
  labels: [],
  created: '2024-01-16T09:00:00Z',
  createdBy: 'alice',
  updated: '2024-01-16T09:00:00Z',
  description: 'We should add a dark mode option.',
  comments: [],
};

describe('formatIssueList', () => {
  test('human format produces aligned table', () => {
    const result = formatIssueList([SAMPLE_ISSUE, SAMPLE_ISSUE_2], 'human');
    expect(result).toContain('ID');
    expect(result).toContain('Title');
    expect(result).toContain('Status');
    expect(result).toContain('#1');
    expect(result).toContain('#2');
    expect(result).toContain('Fix Login Timeout');
    expect(result).toContain('in_progress');
    expect(result).toContain('alice');
    expect(result).toContain('2024-01-15');
  });

  test('human format truncates long titles', () => {
    const longTitle: Issue = {
      ...SAMPLE_ISSUE,
      title: 'This is a very long title that exceeds forty characters easily',
    };
    const result = formatIssueList([longTitle], 'human');
    // Title should be truncated with ellipsis
    expect(result).toContain('\u2026');
    expect(result).not.toContain(
      'This is a very long title that exceeds forty characters easily',
    );
  });

  test('human format shows "No issues found." for empty list', () => {
    const result = formatIssueList([], 'human');
    expect(result).toBe('No issues found.');
  });

  test('json format produces valid JSON array', () => {
    const result = formatIssueList([SAMPLE_ISSUE], 'json');
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(1);
    expect(parsed[0].title).toBe('Fix Login Timeout');
  });

  test('yaml format produces valid YAML', () => {
    const result = formatIssueList([SAMPLE_ISSUE], 'yaml');
    expect(result).toContain('id: 1');
    expect(result).toContain('title: Fix Login Timeout');
    expect(result).toContain('status: in_progress');
  });
});

describe('formatIssueDetail', () => {
  test('human format shows all fields', () => {
    const result = formatIssueDetail(SAMPLE_ISSUE, 'human');
    expect(result).toContain('# #1: Fix Login Timeout');
    expect(result).toContain('Status:     in_progress');
    expect(result).toContain('Priority:   high');
    expect(result).toContain('Assignee:   alice');
    expect(result).toContain('Labels:     bug, urgent');
    expect(result).toContain('Created:    2024-01-15T10:00:00Z by bob');
    expect(result).toContain('Users are experiencing timeouts.');
  });

  test('human format shows comments', () => {
    const result = formatIssueDetail(SAMPLE_ISSUE, 'human');
    expect(result).toContain('## Comments');
    expect(result).toContain('Alice');
    expect(result).toContain('I can reproduce this.');
  });

  test('human format shows dash for empty assignee', () => {
    const result = formatIssueDetail(SAMPLE_ISSUE_2, 'human');
    expect(result).toContain('Assignee:   -');
  });

  test('human format shows dash for empty labels', () => {
    const result = formatIssueDetail(SAMPLE_ISSUE_2, 'human');
    expect(result).toContain('Labels:     -');
  });

  test('json format produces valid JSON object', () => {
    const result = formatIssueDetail(SAMPLE_ISSUE, 'json');
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe(1);
    expect(parsed.title).toBe('Fix Login Timeout');
    expect(parsed.comments).toHaveLength(1);
  });

  test('yaml format produces valid YAML', () => {
    const result = formatIssueDetail(SAMPLE_ISSUE, 'yaml');
    expect(result).toContain('id: 1');
    expect(result).toContain('title: Fix Login Timeout');
    expect(result).toContain('priority: high');
  });
});
