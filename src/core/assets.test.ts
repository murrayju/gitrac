import { describe, expect, test } from 'bun:test';
import { extractAssetRefs } from './assets.ts';

describe('extractAssetRefs', () => {
  test('extracts image refs from markdown', () => {
    const md =
      '![image.png](/.issues/assets/abc123.png)\n\nSome text\n\n![other](/.issues/assets/def456.jpg)';
    expect(extractAssetRefs(md)).toEqual(['abc123.png', 'def456.jpg']);
  });

  test('returns empty array for no refs', () => {
    expect(extractAssetRefs('Just some text')).toEqual([]);
  });

  test('deduplicates refs', () => {
    const md = '![a](/.issues/assets/abc.png) ![b](/.issues/assets/abc.png)';
    expect(extractAssetRefs(md)).toEqual(['abc.png']);
  });

  test('handles inline refs', () => {
    const md = 'See /.issues/assets/foo.webp for details';
    expect(extractAssetRefs(md)).toEqual(['foo.webp']);
  });
});
