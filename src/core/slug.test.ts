import { describe, expect, test } from 'bun:test';
import { issueFilename, parseIssueId, slugify } from './slug.ts';

describe('slugify', () => {
  test('converts title to lowercase hyphenated slug', () => {
    expect(slugify('Fix Login Timeout')).toBe('fix-login-timeout');
  });

  test('strips trailing punctuation', () => {
    expect(slugify('Add dark mode!!!')).toBe('add-dark-mode');
  });

  test('collapses multiple spaces', () => {
    expect(slugify('  Multiple   Spaces  ')).toBe('multiple-spaces');
  });

  test('replaces special characters with hyphens', () => {
    expect(slugify('Special chars: @#$%')).toBe('special-chars');
  });

  test('preserves existing hyphens', () => {
    expect(slugify('Already-slugged')).toBe('already-slugged');
  });
});

describe('issueFilename', () => {
  test('creates filename from id and title', () => {
    expect(issueFilename(1, 'Fix Login Timeout')).toBe(
      '1-fix-login-timeout.md',
    );
  });

  test('creates filename with larger id', () => {
    expect(issueFilename(42, 'Add dark mode')).toBe('42-add-dark-mode.md');
  });
});

describe('parseIssueId', () => {
  test('extracts id from valid issue filename', () => {
    expect(parseIssueId('1-fix-login-timeout.md')).toBe(1);
  });

  test('extracts larger id', () => {
    expect(parseIssueId('42-add-dark-mode.md')).toBe(42);
  });

  test('returns null for non-issue filename', () => {
    expect(parseIssueId('not-an-issue.md')).toBeNull();
  });
});
