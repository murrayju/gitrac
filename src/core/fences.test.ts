import { describe, expect, test } from 'bun:test';
import { closesFence, openFence, scanFences } from './fences.ts';

describe('openFence', () => {
  test('recognizes backtick and tilde fences', () => {
    expect(openFence('```')).toEqual({ char: '`', length: 3 });
    expect(openFence('```ts')).toEqual({ char: '`', length: 3 });
    expect(openFence('~~~')).toEqual({ char: '~', length: 3 });
    expect(openFence('~~~~ md')).toEqual({ char: '~', length: 4 });
  });

  test('allows leading indentation', () => {
    expect(openFence('  ```js')).toEqual({ char: '`', length: 3 });
    expect(openFence('     ~~~')).toEqual({ char: '~', length: 3 });
  });

  test('rejects non-fences', () => {
    expect(openFence('``')).toBeNull();
    expect(openFence('~~')).toBeNull();
    expect(openFence('text ```')).toBeNull();
    expect(openFence('``` a`b')).toBeNull();
  });
});

describe('closesFence', () => {
  test('requires the same char and at least the same length', () => {
    const fence = { char: '`', length: 4 } as const;
    expect(closesFence('````', fence)).toBe(true);
    expect(closesFence('  `````  ', fence)).toBe(true);
    expect(closesFence('```', fence)).toBe(false);
    expect(closesFence('~~~~', fence)).toBe(false);
    expect(closesFence('````js', fence)).toBe(false);
  });
});

describe('scanFences', () => {
  test('classifies lines and reports an unclosed fence', () => {
    const { kinds, open } = scanFences([
      'a',
      '~~~',
      '```',
      '~~~',
      'b',
      '````',
      'c',
    ]);
    expect(kinds).toEqual([
      'text',
      'fence',
      'code',
      'fence',
      'text',
      'fence',
      'code',
    ]);
    expect(open).toEqual({ char: '`', length: 4 });
  });
});
