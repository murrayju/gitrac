import { describe, expect, test } from 'bun:test';
import {
  escapeCommentHeadings,
  parseComments,
  serializeComments,
  unescapeCommentHeadings,
} from './comments.ts';

describe('parseComments', () => {
  test('parses a single comment', () => {
    const input = '### Alice \u2014 2024-01-15T10:30:00Z\n\nThis is the body.';
    const comments = parseComments(input);
    expect(comments).toHaveLength(1);
    expect(comments[0].author).toBe('Alice');
    expect(comments[0].timestamp).toBe('2024-01-15T10:30:00Z');
    expect(comments[0].body).toBe('This is the body.');
  });

  test('parses multiple comments', () => {
    const input = [
      '### Alice \u2014 2024-01-15T10:30:00Z',
      '',
      'First comment.',
      '',
      '### Bob \u2014 2024-01-15T11:00:00Z',
      '',
      'Second comment.',
    ].join('\n');
    const comments = parseComments(input);
    expect(comments).toHaveLength(2);
    expect(comments[0].author).toBe('Alice');
    expect(comments[0].body).toBe('First comment.');
    expect(comments[1].author).toBe('Bob');
    expect(comments[1].body).toBe('Second comment.');
  });

  test('parses a comment containing code fences', () => {
    const input = [
      '### Dev \u2014 2024-01-15T12:00:00Z',
      '',
      'Check this code:',
      '',
      '```javascript',
      'console.log("hello");',
      '```',
    ].join('\n');
    const comments = parseComments(input);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain('```javascript');
    expect(comments[0].body).toContain('console.log("hello");');
  });

  test('unescapes headings in comment body', () => {
    const input = [
      '### Alice \u2014 2024-01-15T10:30:00Z',
      '',
      '\\## My Heading',
      '',
      'Some text.',
    ].join('\n');
    const comments = parseComments(input);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe('## My Heading\n\nSome text.');
  });

  test('returns empty array for empty string', () => {
    expect(parseComments('')).toEqual([]);
  });

  test('returns empty array for whitespace-only string', () => {
    expect(parseComments('   \n  \n  ')).toEqual([]);
  });
});

describe('serializeComments', () => {
  test('serializes a comment to header and body', () => {
    const result = serializeComments([
      { author: 'Alice', timestamp: '2024-01-15T10:30:00Z', body: 'Hello.' },
    ]);
    expect(result).toBe('### Alice \u2014 2024-01-15T10:30:00Z\n\nHello.');
  });

  test('escapes headings in comment body', () => {
    const result = serializeComments([
      {
        author: 'Alice',
        timestamp: '2024-01-15T10:30:00Z',
        body: '## My Heading\n\nSome text.',
      },
    ]);
    expect(result).toBe(
      '### Alice \u2014 2024-01-15T10:30:00Z\n\n\\## My Heading\n\nSome text.',
    );
  });

  test('escapes all heading levels', () => {
    const body = [
      '# H1',
      '## H2',
      '### H3',
      '#### H4',
      '##### H5',
      '###### H6',
    ].join('\n');
    const result = serializeComments([
      { author: 'A', timestamp: 'T', body },
    ]);
    expect(result).toContain('\\# H1');
    expect(result).toContain('\\## H2');
    expect(result).toContain('\\### H3');
    expect(result).toContain('\\#### H4');
    expect(result).toContain('\\##### H5');
    expect(result).toContain('\\###### H6');
  });

  test('preserves code fences unchanged', () => {
    const body = '```\n### not a heading\n```';
    const result = serializeComments([
      { author: 'A', timestamp: 'T', body },
    ]);
    // Inside code fences, ### should still be escaped since we escape all lines
    // Actually, code fence content should be preserved as-is? Let's check the spec.
    // The spec says: "Serialize a comment containing code fences -> unchanged"
    // This means code fences themselves are unchanged, but headings inside are escaped.
    // Wait, re-reading: "escapeCommentHeadings — replace # at start of line with \#"
    // This is a simple line-level operation, so it WILL escape inside code fences.
    // But the test says "unchanged". Let me handle code fences specially.
    expect(result).toContain('```\n### not a heading\n```');
  });

  test('round-trip: parse then serialize produces original text', () => {
    const original = [
      '### Alice \u2014 2024-01-15T10:30:00Z',
      '',
      'Simple comment.',
      '',
      '### Bob \u2014 2024-01-15T11:00:00Z',
      '',
      '\\## Escaped heading',
      '',
      'More text.',
    ].join('\n');
    const comments = parseComments(original);
    const serialized = serializeComments(comments);
    expect(serialized).toBe(original);
  });
});

describe('escapeCommentHeadings', () => {
  test('escapes heading at start of line', () => {
    expect(escapeCommentHeadings('## Heading')).toBe('\\## Heading');
  });

  test('does not escape inside code fences', () => {
    const input = '```\n## Not escaped\n```';
    expect(escapeCommentHeadings(input)).toBe('```\n## Not escaped\n```');
  });
});

describe('unescapeCommentHeadings', () => {
  test('unescapes \\# at start of line', () => {
    expect(unescapeCommentHeadings('\\## Heading')).toBe('## Heading');
  });

  test('does not unescape inside code fences', () => {
    const input = '```\n\\## Still escaped\n```';
    expect(unescapeCommentHeadings(input)).toBe(
      '```\n\\## Still escaped\n```',
    );
  });
});
