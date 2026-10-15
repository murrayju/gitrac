import { describe, expect, test } from 'bun:test';
import { normalizeDescription, sameDescription } from './description.ts';

describe('sameDescription', () => {
  test('ignores leading/trailing whitespace and blank lines', () => {
    const code = 'Intro\n\n```js\nconst a = 1;\n```';
    expect(sameDescription(code, `${code}\n\n`)).toBe(true);
    expect(sameDescription(code, `\n${code}\n \n\t\n`)).toBe(true);
    expect(sameDescription('', '\n\n')).toBe(true);
    expect(normalizeDescription('  text \n\n')).toBe('text');
  });

  test('whitespace inside the text is significant', () => {
    // A trailing double space is a hard break
    expect(sameDescription('a  \nb', 'a\nb')).toBe(false);
    expect(sameDescription('a\n\nb', 'a\nb')).toBe(false);
    expect(sameDescription('```\ncode \n```', '```\ncode\n```')).toBe(false);
    expect(sameDescription('text', 'text.')).toBe(false);
  });
});
