import { describe, expect, test } from 'bun:test';
import { ApiError, type DuplicateFile, type DuplicateIssueId } from '../api.ts';
import { errorText, renumberPlan } from './duplicates.ts';

/** Regression tests for #126: the previewed renumbering. */

function file(path: string): DuplicateFile {
  return { path, filename: path, closed: false, title: path, created: null };
}

const duplicate: DuplicateIssueId = {
  id: 7,
  files: [file('a'), file('b'), file('c')],
  keep: 'a',
  newIds: [10, 11],
};

function plan(keep: string): [string, number | null][] {
  return renumberPlan(duplicate, keep).map((p) => [p.file.path, p.newId]);
}

describe('renumberPlan', () => {
  test('the suggested keeper keeps the ID; the others get the new IDs in order', () => {
    expect(plan('a')).toEqual([
      ['a', null],
      ['b', 10],
      ['c', 11],
    ]);
  });

  test('another keeper takes the ID; the new IDs move to the others', () => {
    expect(plan('b')).toEqual([
      ['a', 10],
      ['b', null],
      ['c', 11],
    ]);
  });

  test('an unknown keeper falls back to the suggestion', () => {
    expect(plan('zzz')).toEqual(plan('a'));
  });
});

describe('errorText', () => {
  test("is the server's error message, else the error's message", () => {
    expect(errorText(new ApiError(409, '{"error":"Not duplicated"}'))).toBe(
      'Not duplicated',
    );
    expect(errorText(new ApiError(500, 'oops'))).toBe('API error 500: oops');
    expect(errorText(new Error('network'))).toBe('network');
  });
});
