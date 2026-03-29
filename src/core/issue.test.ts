import { describe, expect, test } from 'bun:test';
import { parseIssue, serializeIssue } from './issue.ts';

const FULL_ISSUE = `---
id: 1
title: Fix Login Timeout
status: in_progress
priority: high
assignee: alice
labels:
  - bug
  - urgent
created: "2024-01-15T10:00:00Z"
createdBy: bob
updated: "2024-01-15T12:00:00Z"
---

Users are experiencing timeouts when logging in during peak hours.

## Steps to Reproduce

1. Go to login page
2. Enter credentials
3. Wait 30 seconds

---

### Alice \u2014 2024-01-15T11:00:00Z

I can reproduce this. Looks like a connection pool issue.

### Bob \u2014 2024-01-15T12:00:00Z

\\## Fix Attempt

Increased pool size to 20.`;

const ISSUE_NO_COMMENTS = `---
id: 2
title: Add dark mode
status: backlog
priority: medium
assignee: ""
labels: []
created: "2024-01-16T09:00:00Z"
createdBy: alice
updated: "2024-01-16T09:00:00Z"
---

We should add a dark mode option to the UI.`;

const ISSUE_EMPTY_DESCRIPTION = `---
id: 3
title: Empty issue
status: todo
priority: low
assignee: ""
labels: []
created: "2024-01-17T09:00:00Z"
createdBy: bob
updated: "2024-01-17T09:00:00Z"
---
`;

describe('parseIssue', () => {
  test('parses a complete issue with frontmatter, description, and comments', () => {
    const issue = parseIssue(FULL_ISSUE);
    expect(issue.id).toBe(1);
    expect(issue.title).toBe('Fix Login Timeout');
    expect(issue.status).toBe('in_progress');
    expect(issue.priority).toBe('high');
    expect(issue.assignee).toBe('alice');
    expect(issue.labels).toEqual(['bug', 'urgent']);
    expect(issue.created).toBe('2024-01-15T10:00:00Z');
    expect(issue.createdBy).toBe('bob');
    expect(issue.updated).toBe('2024-01-15T12:00:00Z');
    expect(issue.description).toContain('Users are experiencing timeouts');
    expect(issue.description).toContain('## Steps to Reproduce');
    expect(issue.comments).toHaveLength(2);
    expect(issue.comments[0]?.author).toBe('Alice');
    expect(issue.comments[0]?.body).toContain('connection pool issue');
    expect(issue.comments[1]?.author).toBe('Bob');
    expect(issue.comments[1]?.body).toContain('## Fix Attempt');
  });

  test('parses an issue with no comments', () => {
    const issue = parseIssue(ISSUE_NO_COMMENTS);
    expect(issue.id).toBe(2);
    expect(issue.title).toBe('Add dark mode');
    expect(issue.comments).toEqual([]);
    expect(issue.description).toBe(
      'We should add a dark mode option to the UI.',
    );
  });

  test('parses an issue with empty description', () => {
    const issue = parseIssue(ISSUE_EMPTY_DESCRIPTION);
    expect(issue.id).toBe(3);
    expect(issue.description).toBe('');
    expect(issue.comments).toEqual([]);
  });

  test('parses an issue with headings in description (NOT escaped)', () => {
    const issue = parseIssue(FULL_ISSUE);
    // Headings in description should appear as-is
    expect(issue.description).toContain('## Steps to Reproduce');
  });

  test('parses frontmatter fields correctly', () => {
    const issue = parseIssue(FULL_ISSUE);
    expect(issue.id).toBe(1);
    expect(issue.title).toBe('Fix Login Timeout');
    expect(issue.status).toBe('in_progress');
    expect(issue.priority).toBe('high');
    expect(issue.assignee).toBe('alice');
    expect(issue.labels).toEqual(['bug', 'urgent']);
    expect(issue.created).toBe('2024-01-15T10:00:00Z');
    expect(issue.createdBy).toBe('bob');
    expect(issue.updated).toBe('2024-01-15T12:00:00Z');
  });
});

describe('serializeIssue', () => {
  test('serializes an Issue back to markdown with frontmatter', () => {
    const issue = parseIssue(ISSUE_NO_COMMENTS);
    const result = serializeIssue(issue);
    expect(result).toContain('---');
    expect(result).toContain('id: 2');
    expect(result).toContain('title: Add dark mode');
    expect(result).toContain('We should add a dark mode option to the UI.');
  });

  test('round-trip: parse then serialize produces semantically equivalent output', () => {
    const issue = parseIssue(FULL_ISSUE);
    const serialized = serializeIssue(issue);
    const reparsed = parseIssue(serialized);
    expect(reparsed.id).toBe(issue.id);
    expect(reparsed.title).toBe(issue.title);
    expect(reparsed.status).toBe(issue.status);
    expect(reparsed.priority).toBe(issue.priority);
    expect(reparsed.assignee).toBe(issue.assignee);
    expect(reparsed.labels).toEqual(issue.labels);
    expect(reparsed.description).toBe(issue.description);
    expect(reparsed.comments).toHaveLength(issue.comments.length);
    for (let i = 0; i < issue.comments.length; i++) {
      expect(reparsed.comments[i]?.author).toBe(issue.comments[i]?.author);
      expect(reparsed.comments[i]?.timestamp).toBe(
        issue.comments[i]?.timestamp,
      );
      expect(reparsed.comments[i]?.body).toBe(issue.comments[i]?.body);
    }
  });

  test('issue with comments includes --- separator', () => {
    const issue = parseIssue(FULL_ISSUE);
    const serialized = serializeIssue(issue);
    // After the frontmatter closing ---, there should be description, then ---, then comments
    const afterFrontmatter = serialized.split('---').slice(2).join('---');
    // Should contain a --- separator between description and comments
    expect(afterFrontmatter).toContain('---');
  });

  test('issue with no comments has no trailing ---', () => {
    const issue = parseIssue(ISSUE_NO_COMMENTS);
    const serialized = serializeIssue(issue);
    // Should have exactly 2 --- (frontmatter open and close)
    const parts = serialized.split('---');
    // parts[0] is empty before first ---, parts[1] is frontmatter, parts[2] is rest
    expect(parts.length).toBe(3);
    // No trailing ---
    expect(serialized.trimEnd().endsWith('---')).toBe(false);
  });
});
