import { describe, expect, test } from 'bun:test';
import { needsSave, reconcileIncoming } from './description-sync.ts';

const base = { version: '"v1"', text: 'original' };

describe('reconcileIncoming', () => {
  test('same version and text is a no-op', () => {
    expect(reconcileIncoming(base, { ...base }, false)).toBe('none');
    expect(reconcileIncoming(base, { ...base }, true)).toBe('none');
  });

  test('same version is a no-op even if the text differs', () => {
    expect(reconcileIncoming(base, { ...base, text: 'other' }, true)).toBe(
      'none',
    );
  });

  test('new version with the same description just rebases', () => {
    const incoming = { version: '"v2"', text: 'original' };
    expect(reconcileIncoming(base, incoming, false)).toBe('rebase');
    // Unsaved edits are kept: an unrelated change (comment, status) is not
    // a conflict.
    expect(reconcileIncoming(base, incoming, true)).toBe('rebase');
  });

  test('external description change replaces a clean editor', () => {
    const incoming = { version: '"v2"', text: 'changed by CLI' };
    expect(reconcileIncoming(base, incoming, false)).toBe('replace');
  });

  test('external description change with unsaved edits is a conflict', () => {
    const incoming = { version: '"v2"', text: 'changed by CLI' };
    expect(reconcileIncoming(base, incoming, true)).toBe('conflict');
  });
});

describe('needsSave (#90)', () => {
  const code = 'Intro\n\n```js\nconst a = 1;\n```';
  const based = { version: '"v1"', text: code };

  test('the base markdown, give or take surrounding whitespace, is not saved', () => {
    expect(needsSave(code, based, null)).toBe(false);
    expect(needsSave(`${code}\n\n`, based, null)).toBe(false);
    expect(
      needsSave(`\n${code}\n`, based, { text: code, markdown: code }),
    ).toBe(false);
  });

  test('a real edit is saved, including whitespace inside the text', () => {
    expect(needsSave(`${code}\n\nMore`, based, null)).toBe(true);
    const text = { version: '"v1"', text: 'a\nb' };
    expect(needsSave('a  \nb', text, null)).toBe(true);
    expect(needsSave('', based, null)).toBe(true);
  });

  test("the editor's own serialization of the loaded base is not saved", () => {
    const stars = { version: '"v1"', text: '* a\n* b' };
    const loaded = { text: '* a\n* b', markdown: '- a\n- b' };
    expect(needsSave('- a\n- b', stars, loaded)).toBe(false);
    expect(needsSave('- a\n- b\n- c', stars, loaded)).toBe(true);
    // Once the base moved on (a save, an external change), it's a change
    const moved = { version: '"v2"', text: '* a' };
    expect(needsSave('- a\n- b', moved, loaded)).toBe(true);
    // Unknown serialization: compare with the base text only
    expect(
      needsSave('- a\n- b', stars, { text: '* a\n* b', markdown: null }),
    ).toBe(true);
  });
});
