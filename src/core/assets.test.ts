import { describe, expect, test } from 'bun:test';
import { extractAssetRefs } from './assets.ts';

describe('extractAssetRefs', () => {
  test('extracts image refs from markdown', () => {
    const md =
      '![image.png](/api/issues/assets/abc123.png)\n\nSome text\n\n![other](/api/issues/assets/def456.jpg)';
    expect(extractAssetRefs(md)).toEqual(['abc123.png', 'def456.jpg']);
  });

  test('returns empty array for no refs', () => {
    expect(extractAssetRefs('Just some text')).toEqual([]);
  });

  test('deduplicates refs', () => {
    const md =
      '![a](/api/issues/assets/abc.png) ![b](/api/issues/assets/abc.png)';
    expect(extractAssetRefs(md)).toEqual(['abc.png']);
  });

  test('handles inline refs', () => {
    const md = 'See /api/issues/assets/foo.webp for details';
    expect(extractAssetRefs(md)).toEqual(['foo.webp']);
  });
});
