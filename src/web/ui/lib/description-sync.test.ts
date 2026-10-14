import { describe, expect, test } from 'bun:test';
import { reconcileIncoming } from './description-sync.ts';

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
