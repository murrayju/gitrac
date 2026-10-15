import { describe, expect, test } from 'bun:test';
import { createDefaultConfig } from './config.ts';
import { GitracError } from './errors.ts';
import { assertCanClose, assertCanReopen, reopenStatus } from './lifecycle.ts';

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof GitracError ? err.code : 'other';
  }
}

describe('assertCanClose', () => {
  test('rejects only fully closed issues', () => {
    expect(codeOf(() => assertCanClose({ id: 1, status: 'done' }, true))).toBe(
      'invalid_state',
    );
    expect(
      codeOf(() => assertCanClose({ id: 1, status: 'cancelled' }, true)),
    ).toBe('invalid_state');
    expect(codeOf(() => assertCanClose({ id: 1, status: 'todo' }, false))).toBe(
      null,
    );
    // Half-way states can be closed (repair)
    expect(codeOf(() => assertCanClose({ id: 1, status: 'done' }, false))).toBe(
      null,
    );
    expect(codeOf(() => assertCanClose({ id: 1, status: 'todo' }, true))).toBe(
      null,
    );
  });
});

describe('assertCanReopen', () => {
  test('rejects only fully open issues', () => {
    expect(
      codeOf(() => assertCanReopen({ id: 1, status: 'backlog' }, false)),
    ).toBe('invalid_state');
    expect(codeOf(() => assertCanReopen({ id: 1, status: 'done' }, true))).toBe(
      null,
    );
    expect(
      codeOf(() => assertCanReopen({ id: 1, status: 'done' }, false)),
    ).toBe(null);
    expect(codeOf(() => assertCanReopen({ id: 1, status: 'todo' }, true))).toBe(
      null,
    );
  });
});

describe('reopenStatus', () => {
  test('defaults to config.defaultStatus', () => {
    const config = createDefaultConfig();
    config.defaultStatus = 'todo';
    expect(reopenStatus(config)).toBe('todo');
  });

  test('never reopens into a closed default status', () => {
    const config = createDefaultConfig();
    config.defaultStatus = 'done';
    expect(reopenStatus(config)).toBe('backlog');
  });

  test('accepts a requested open status', () => {
    expect(reopenStatus(createDefaultConfig(), 'in_progress')).toBe(
      'in_progress',
    );
  });

  test('rejects closed, unknown and non-string statuses', () => {
    const config = createDefaultConfig();
    for (const s of ['done', 'cancelled', 'bogus', 3, null]) {
      expect(codeOf(() => reopenStatus(config, s))).toBe('invalid_input');
    }
  });
});
