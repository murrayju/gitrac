import { describe, expect, test } from 'bun:test';
import { extractAssetRefs, isAssetFilename } from './assets.ts';

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

describe('isAssetFilename', () => {
  test('accepts plain filenames', () => {
    expect(isAssetFilename('abc123.png')).toBe(true);
    expect(isAssetFilename('V1StGXR8_Z5jdHi6B-myT.webp')).toBe(true);
  });

  test('rejects paths and traversal', () => {
    expect(isAssetFilename('')).toBe(false);
    expect(isAssetFilename('..')).toBe(false);
    expect(isAssetFilename('../config.yaml')).toBe(false);
    expect(isAssetFilename('../../src/index.ts')).toBe(false);
    expect(isAssetFilename('sub/a.png')).toBe(false);
    expect(isAssetFilename('..\\a.png')).toBe(false);
  });
});
