import { describe, expect, test } from 'bun:test';
import {
  parseIssueId,
  parseIssueIds,
  parseSingleIssueId,
} from './issue-id-input.ts';

describe('parseIssueId', () => {
  test('accepts a number with or without #', () => {
    expect(parseIssueId('12')).toBe(12);
    expect(parseIssueId('#12')).toBe(12);
    expect(parseIssueId('  #7 ')).toBe(7);
  });

  test('rejects anything else', () => {
    for (const text of ['', '#', '0', '#0', '012', '-3', '1.5', 'abc', '##3']) {
      expect(parseIssueId(text)).toBeNull();
    }
    expect(parseIssueId('99999999999999999999')).toBeNull();
  });
});

describe('parseIssueIds', () => {
  test('splits on commas and whitespace, sorts and de-duplicates', () => {
    expect(parseIssueIds('#4, 3  #4,5')).toEqual({ ok: true, ids: [3, 4, 5] });
    expect(parseIssueIds('3,')).toEqual({ ok: true, ids: [3] });
  });

  test('names the bad token', () => {
    expect(parseIssueIds('3, x')).toEqual({
      ok: false,
      error: 'Not an issue number: x',
    });
  });

  test('blank input asks for a number', () => {
    expect(parseIssueIds('  ')).toEqual({
      ok: false,
      error: 'Enter an issue number, e.g. #12',
    });
  });
});

describe('parseSingleIssueId', () => {
  test('accepts exactly one ID', () => {
    expect(parseSingleIssueId('#9')).toEqual({ ok: true, ids: [9] });
    expect(parseSingleIssueId('#9 #9')).toEqual({ ok: true, ids: [9] });
  });

  test('rejects more than one', () => {
    expect(parseSingleIssueId('1, 2')).toEqual({
      ok: false,
      error: 'Enter only one issue number',
    });
  });
});
