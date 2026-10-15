import { describe, expect, test } from 'bun:test';
import { effectiveAuthor, identityOptions } from './identity.ts';

const assignees = [
  { name: 'Ada Lovelace', email: 'ada@example.com' },
  { name: 'Grace Hopper', email: 'grace@example.com' },
  { name: 'Grace Hopper', email: 'grace2@example.com' },
];

describe('identityOptions', () => {
  test('default first, then unique assignee names excluding the default', () => {
    expect(identityOptions('Ada Lovelace', assignees)).toEqual([
      { value: '', label: 'Ada Lovelace (git)' },
      { value: 'Grace Hopper', label: 'Grace Hopper' },
    ]);
  });

  test('works before the identity has loaded', () => {
    expect(identityOptions(null, [])).toEqual([
      { value: '', label: 'Git identity' },
    ]);
  });
});

describe('effectiveAuthor', () => {
  test('sends a configured assignee', () => {
    expect(effectiveAuthor('Grace Hopper', 'Ada Lovelace', assignees)).toBe(
      'Grace Hopper',
    );
  });

  test('omits the default, empty, or no-longer-configured choices', () => {
    expect(effectiveAuthor('', 'Ada Lovelace', assignees)).toBeUndefined();
    expect(
      effectiveAuthor('Ada Lovelace', 'Ada Lovelace', assignees),
    ).toBeUndefined();
    expect(effectiveAuthor('Bob', 'Ada Lovelace', assignees)).toBeUndefined();
  });
});
