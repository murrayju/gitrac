import { describe, expect, test } from 'bun:test';
import yaml from 'js-yaml';
import { parseIssue } from '../core/issue.ts';
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

  test('human format shows labels (#52)', () => {
    const result = formatIssueList([SAMPLE_ISSUE, SAMPLE_ISSUE_2], 'human');
    const [header, , row1, row2] = result.split('\n');
    expect(header).toContain('Labels');
    expect(row1).toContain('bug, urgent');
    expect(row2?.trimEnd().endsWith('-')).toBe(true);
  });

  test('human format keeps columns aligned for long assignees', () => {
    const long = { ...SAMPLE_ISSUE, assignee: 'someone.long@example.com' };
    const [header, , row] = formatIssueList(
      [long, SAMPLE_ISSUE_2],
      'human',
    ).split('\n');
    expect(row?.indexOf('2024-01-15')).toBe(header?.indexOf('Updated'));
    expect(row?.indexOf('bug, urgent')).toBe(header?.indexOf('Labels'));
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

describe('detail with resolved dependencies (#102)', () => {
  const linked: Issue = { ...SAMPLE_ISSUE_2, parent: 5, blockedBy: [1, 9] };
  const deps = {
    parent: { id: 5, title: 'Epic', status: 'todo', resolved: false },
    children: [{ id: 7, title: 'Child', status: 'backlog', resolved: false }],
    blockedBy: [
      { id: 1, title: 'Fix Login Timeout', status: 'done', resolved: true },
      { id: 9, title: '', status: null, resolved: true },
    ],
    blocks: [{ id: 8, title: 'Later', status: 'todo', resolved: false }],
    blocked: false,
  };
  const mark = {
    claimedElsewhere: {
      ref: 'agent-1',
      assignee: 'bob@example.com',
      updated: '2024-01-17T00:00:00Z',
    },
  };

  test('json adds a dependencies field and keeps parent / blockedBy', () => {
    const parsed = JSON.parse(formatIssueDetail(linked, 'json', deps, mark));
    expect(parsed.dependencies).toEqual(deps);
    expect(parsed.parent).toBe(5);
    expect(parsed.blockedBy).toEqual([1, 9]);
    expect(parsed.claimedElsewhere).toEqual(mark.claimedElsewhere);
  });

  test('yaml adds a dependencies field and keeps parent / blockedBy', () => {
    const parsed = yaml.load(
      formatIssueDetail(linked, 'yaml', deps, mark),
    ) as Record<string, unknown>;
    expect(parsed.dependencies).toEqual(deps);
    expect(parsed.parent).toBe(5);
    expect(parsed.blockedBy).toEqual([1, 9]);
    expect(parsed.claimedElsewhere).toEqual(mark.claimedElsewhere);
  });

  test('without deps, json/yaml have no dependencies field', () => {
    expect(JSON.parse(formatIssueDetail(linked, 'json'))).not.toHaveProperty(
      'dependencies',
    );
    expect(formatIssueDetail(linked, 'yaml')).not.toContain('dependencies:');
  });
});

describe('marks for versions elsewhere (#93)', () => {
  const claim = {
    ref: 'agent-1',
    worktree: '/wt/agent-1',
    assignee: 'bob@example.com',
    updated: '2024-01-17T00:00:00Z',
  };
  const closed = {
    ref: 'agent-2',
    status: 'done',
    updated: '2024-01-18T00:00:00Z',
  };
  const marks = new Map([
    [1, { claimedElsewhere: claim }],
    [2, { closedElsewhere: closed }],
  ]);

  test('human list appends where the issue is claimed or closed', () => {
    const [, , row1, row2] = formatIssueList(
      [SAMPLE_ISSUE, SAMPLE_ISSUE_2],
      'human',
      marks,
    ).split('\n');
    expect(row1).toEndWith(
      '  [claimed in worktree /wt/agent-1 (branch agent-1) by bob@example.com]',
    );
    expect(row2).toEndWith('  [closed (done) on branch agent-2]');
  });

  test('json list adds claimedElsewhere / closedElsewhere', () => {
    const [one, two] = JSON.parse(
      formatIssueList([SAMPLE_ISSUE, SAMPLE_ISSUE_2], 'json', marks),
    );
    expect(one.claimedElsewhere).toEqual(claim);
    expect(one).not.toHaveProperty('closedElsewhere');
    expect(two.closedElsewhere).toEqual(closed);
    expect(two).not.toHaveProperty('claimedElsewhere');
  });

  test('detail shows an Elsewhere line, and the field in json/yaml', () => {
    const mark = { closedElsewhere: { ...closed, worktree: '/wt/agent-2' } };
    expect(
      formatIssueDetail(SAMPLE_ISSUE_2, 'human', undefined, mark),
    ).toContain(
      'Elsewhere:  closed (done) in worktree /wt/agent-2 (branch agent-2) (2024-01-18T00:00:00Z)',
    );
    expect(
      JSON.parse(formatIssueDetail(SAMPLE_ISSUE_2, 'json', undefined, mark))
        .closedElsewhere,
    ).toEqual(mark.closedElsewhere);
    expect(
      formatIssueDetail(SAMPLE_ISSUE_2, 'yaml', undefined, mark),
    ).toContain('closedElsewhere:');
    expect(formatIssueDetail(SAMPLE_ISSUE_2, 'human')).not.toContain(
      'Elsewhere:',
    );
  });
});

describe('issues parsed with unquoted YAML dates', () => {
  const parsed = parseIssue(`---
id: 5
title: Unquoted
status: todo
priority: low
assignee: ""
labels: []
created: 2026-03-28T12:00:00Z
createdBy: bob
updated: 2026-03-28T14:30:00Z
---
`);

  test('human list renders the updated date', () => {
    expect(formatIssueList([parsed], 'human')).toContain('2026-03-28');
  });

  test('json output keeps timestamps as written', () => {
    const [json] = JSON.parse(formatIssueList([parsed], 'json'));
    expect(json.created).toBe('2026-03-28T12:00:00Z');
    expect(json.updated).toBe('2026-03-28T14:30:00Z');
  });
});
