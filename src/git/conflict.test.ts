import { describe, expect, test } from 'bun:test';
import type { Comment, IssueFrontmatter } from '../core/types.ts';
import {
  mergeComments,
  mergeIssueFrontmatter,
  resolveIssueConflict,
} from './conflict.ts';

function makeFrontmatter(
  overrides: Partial<IssueFrontmatter> = {},
): IssueFrontmatter {
  return {
    id: 1,
    title: 'Test Issue',
    status: 'backlog',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2025-01-01T00:00:00Z',
    createdBy: 'tester',
    updated: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('mergeIssueFrontmatter', () => {
  test('returns ours when nothing changed', () => {
    const base = makeFrontmatter();
    const ours = makeFrontmatter();
    const theirs = makeFrontmatter();
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result).toEqual(ours);
  });

  test('takes theirs change when ours unchanged', () => {
    const base = makeFrontmatter();
    const ours = makeFrontmatter();
    const theirs = makeFrontmatter({ status: 'in_progress' });
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result.status).toBe('in_progress');
  });

  test('takes ours change when theirs unchanged', () => {
    const base = makeFrontmatter();
    const ours = makeFrontmatter({ priority: 'high' });
    const theirs = makeFrontmatter();
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result.priority).toBe('high');
  });

  test('ours wins when both changed same field', () => {
    const base = makeFrontmatter();
    const ours = makeFrontmatter({ status: 'done' });
    const theirs = makeFrontmatter({ status: 'in_progress' });
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result.status).toBe('done');
  });

  test('merges different fields from both sides', () => {
    const base = makeFrontmatter();
    const ours = makeFrontmatter({ priority: 'high' });
    const theirs = makeFrontmatter({ status: 'in_progress' });
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result.priority).toBe('high');
    expect(result.status).toBe('in_progress');
  });

  test('handles labels merge (ours wins if both changed)', () => {
    const base = makeFrontmatter({ labels: ['bug'] });
    const ours = makeFrontmatter({ labels: ['bug', 'feature'] });
    const theirs = makeFrontmatter({ labels: ['bug', 'docs'] });
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result.labels).toEqual(['bug', 'feature']);
  });

  test('handles assignee change', () => {
    const base = makeFrontmatter({ assignee: '' });
    const ours = makeFrontmatter({ assignee: '' });
    const theirs = makeFrontmatter({ assignee: 'alice' });
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result.assignee).toBe('alice');
  });
});

describe('mergeComments', () => {
  test('returns empty array for no comments', () => {
    expect(mergeComments([], [])).toEqual([]);
  });

  test('union of disjoint comments', () => {
    const ours: Comment[] = [
      { author: 'alice', timestamp: '2025-01-01T00:00:00Z', body: 'hello' },
    ];
    const theirs: Comment[] = [
      { author: 'bob', timestamp: '2025-01-02T00:00:00Z', body: 'world' },
    ];
    const result = mergeComments(ours, theirs);
    expect(result).toHaveLength(2);
    expect(result[0]?.author).toBe('alice');
    expect(result[1]?.author).toBe('bob');
  });

  test('deduplicates by author+timestamp', () => {
    const comment: Comment = {
      author: 'alice',
      timestamp: '2025-01-01T00:00:00Z',
      body: 'hello',
    };
    const result = mergeComments([comment], [comment]);
    expect(result).toHaveLength(1);
  });

  test('sorts by timestamp', () => {
    const ours: Comment[] = [
      { author: 'alice', timestamp: '2025-01-03T00:00:00Z', body: 'third' },
    ];
    const theirs: Comment[] = [
      { author: 'bob', timestamp: '2025-01-01T00:00:00Z', body: 'first' },
      { author: 'carol', timestamp: '2025-01-02T00:00:00Z', body: 'second' },
    ];
    const result = mergeComments(ours, theirs);
    expect(result).toHaveLength(3);
    expect(result[0]?.author).toBe('bob');
    expect(result[1]?.author).toBe('carol');
    expect(result[2]?.author).toBe('alice');
  });

  test('keeps ours body when duplicate has different body', () => {
    const ours: Comment[] = [
      {
        author: 'alice',
        timestamp: '2025-01-01T00:00:00Z',
        body: 'ours version',
      },
    ];
    const theirs: Comment[] = [
      {
        author: 'alice',
        timestamp: '2025-01-01T00:00:00Z',
        body: 'theirs version',
      },
    ];
    const result = mergeComments(ours, theirs);
    expect(result).toHaveLength(1);
    expect(result[0]?.body).toBe('ours version');
  });
});

describe('resolveIssueConflict', () => {
  const baseContent = [
    '---',
    'id: 1',
    'title: Test Issue',
    'status: backlog',
    'priority: medium',
    'assignee: ""',
    'labels: []',
    'created: "2025-01-01T00:00:00Z"',
    'createdBy: tester',
    'updated: "2025-01-01T00:00:00Z"',
    '---',
    '',
    'Base description.',
    '',
  ].join('\n');

  test('merges when only frontmatter changed', () => {
    const oursContent = baseContent.replace(
      'status: backlog',
      'status: in_progress',
    );
    const theirsContent = baseContent.replace(
      'priority: medium',
      'priority: high',
    );
    const result = resolveIssueConflict(
      oursContent,
      theirsContent,
      baseContent,
    );
    expect(result).not.toBeNull();
    expect(result).toContain('in_progress');
    expect(result).toContain('high');
  });

  test('returns null when descriptions conflict', () => {
    const oursContent = baseContent.replace(
      'Base description.',
      'Our new description.',
    );
    const theirsContent = baseContent.replace(
      'Base description.',
      'Their new description.',
    );
    const result = resolveIssueConflict(
      oursContent,
      theirsContent,
      baseContent,
    );
    expect(result).toBeNull();
  });

  test('merges when only one side changed description', () => {
    const oursContent = baseContent.replace(
      'Base description.',
      'Updated description.',
    );
    const theirsContent = baseContent;
    const result = resolveIssueConflict(
      oursContent,
      theirsContent,
      baseContent,
    );
    expect(result).not.toBeNull();
    expect(result).toContain('Updated description.');
  });

  test('merges comments from both sides', () => {
    const oursContent = `${baseContent.trimEnd()}\n\n---\n\n### alice \u2014 2025-01-02T00:00:00Z\n\nhello\n`;
    const theirsContent = `${baseContent.trimEnd()}\n\n---\n\n### bob \u2014 2025-01-03T00:00:00Z\n\nworld\n`;
    const result = resolveIssueConflict(
      oursContent,
      theirsContent,
      baseContent,
    );
    expect(result).not.toBeNull();
    expect(result).toContain('alice');
    expect(result).toContain('bob');
  });
});
