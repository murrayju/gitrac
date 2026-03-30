import { describe, expect, test } from 'bun:test';
import { normalizeImageWhitespace } from './markdown.ts';

describe('normalizeImageWhitespace', () => {
  test('adds blank line before image', () => {
    const input = 'Some text\n![image](/api/issues/assets/abc.png)\nMore text';
    const expected =
      'Some text\n\n![image](/api/issues/assets/abc.png)\n\nMore text';
    expect(normalizeImageWhitespace(input)).toBe(expected);
  });

  test('preserves existing blank lines', () => {
    const input =
      'Some text\n\n![image](/api/issues/assets/abc.png)\n\nMore text';
    expect(normalizeImageWhitespace(input)).toBe(input);
  });

  test('handles multiple images', () => {
    const input = 'Text\n![a](/a.png)\n![b](/b.png)\nText';
    const expected = 'Text\n\n![a](/a.png)\n\n![b](/b.png)\n\nText';
    expect(normalizeImageWhitespace(input)).toBe(expected);
  });

  test('no change needed for text-only content', () => {
    const input = 'Just some text\n\nAnother paragraph';
    expect(normalizeImageWhitespace(input)).toBe(input);
  });

  test('handles image at start', () => {
    const input = '![img](/x.png)\nText';
    const expected = '![img](/x.png)\n\nText';
    expect(normalizeImageWhitespace(input)).toBe(expected);
  });

  test('handles image at end', () => {
    const input = 'Text\n![img](/x.png)';
    const expected = 'Text\n\n![img](/x.png)';
    expect(normalizeImageWhitespace(input)).toBe(expected);
  });

  test('does not triple-space', () => {
    const input = 'Text\n\n\n![img](/x.png)\n\n\nMore';
    const expected = 'Text\n\n![img](/x.png)\n\nMore';
    expect(normalizeImageWhitespace(input)).toBe(expected);
  });
});
