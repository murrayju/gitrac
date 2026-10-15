import { describe, expect, test } from 'bun:test';
import { findIssueRefs, issuePath } from './issue-refs.ts';

function ids(text: string): number[] {
  return findIssueRefs(text).map((r) => r.id);
}

describe('findIssueRefs', () => {
  test('finds #N with its offsets', () => {
    expect(findIssueRefs('see #3 and #120')).toEqual([
      { start: 4, end: 6, id: 3 },
      { start: 11, end: 15, id: 120 },
    ]);
  });

  test('at the start/end of the text and around punctuation', () => {
    expect(ids('#1')).toEqual([1]);
    expect(ids('(#2), #3. #4, #5; #6: #7! #8?')).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(ids('[#9]')).toEqual([9]);
    expect(ids('"#10"')).toEqual([10]);
    expect(ids('#11-#12')).toEqual([11, 12]);
    expect(ids('#13 - fix')).toEqual([13]);
    expect(ids('line\n#14')).toEqual([14]);
  });

  test('requires a word boundary before', () => {
    expect(ids('abc#3')).toEqual([]);
    expect(ids('issue#3')).toEqual([]);
    expect(ids('x_#3')).toEqual([]);
    expect(ids('9#3')).toEqual([]);
    expect(ids('é#3')).toEqual([]);
    expect(ids('##3')).toEqual([]);
    expect(ids('&#38;')).toEqual([]);
  });

  test('requires a word boundary after', () => {
    expect(ids('#3a')).toEqual([]);
    expect(ids('#3_x')).toEqual([]);
    expect(ids('#3é')).toEqual([]);
    expect(ids('#3.5')).toEqual([]);
  });

  test('skips heading anchors and colors', () => {
    expect(ids('see README.md#3-setup')).toEqual([]);
    expect(ids('jump to #3-installation')).toEqual([]);
    expect(ids('/#3')).toEqual([]);
    expect(ids('color #fff')).toEqual([]);
  });

  test('skips references inside URLs', () => {
    expect(ids('https://example.com/page#3')).toEqual([]);
    expect(ids('https://example.com/?a=b,#3')).toEqual([]);
    expect(ids('http://x.org/#4 then #5')).toEqual([5]);
    expect(ids('www.example.com/a-#6')).toEqual([]);
    expect(ids('mailto:a@b.c?x=#7')).toEqual([]);
    expect(ids('url: https://x.y/z #8')).toEqual([8]);
  });

  test('needs a positive number without a leading zero', () => {
    expect(ids('#0')).toEqual([]);
    expect(ids('#007')).toEqual([]);
    expect(ids('# 3')).toEqual([]);
    expect(ids('#')).toEqual([]);
    expect(ids('#99999999999999999999')).toEqual([]);
  });

  test('no # means no matches', () => {
    expect(findIssueRefs('plain text 3')).toEqual([]);
  });
});

describe('issuePath', () => {
  test('is the issue detail route', () => {
    expect(issuePath(42)).toBe('/issues/42');
  });
});
