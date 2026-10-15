import { describe, expect, test } from 'bun:test';
import { createDefaultConfig } from './config.ts';
import { GitracError } from './errors.ts';
import {
  assertCanClose,
  assertCanReopen,
  closingStatus,
  reopenStatus,
} from './lifecycle.ts';

const CONFIG = createDefaultConfig();

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
    expect(
      codeOf(() => assertCanClose({ id: 1, status: 'done' }, true, CONFIG)),
    ).toBe('invalid_state');
    expect(
      codeOf(() =>
        assertCanClose({ id: 1, status: 'cancelled' }, true, CONFIG),
      ),
    ).toBe('invalid_state');
    expect(
      codeOf(() => assertCanClose({ id: 1, status: 'todo' }, false, CONFIG)),
    ).toBe(null);
    // Half-way states can be closed (repair)
    expect(
      codeOf(() => assertCanClose({ id: 1, status: 'done' }, false, CONFIG)),
    ).toBe(null);
    expect(
      codeOf(() => assertCanClose({ id: 1, status: 'todo' }, true, CONFIG)),
    ).toBe(null);
  });
});

describe('assertCanReopen', () => {
  test('rejects only fully open issues', () => {
    expect(
      codeOf(() =>
        assertCanReopen({ id: 1, status: 'backlog' }, false, CONFIG),
      ),
    ).toBe('invalid_state');
    expect(
      codeOf(() => assertCanReopen({ id: 1, status: 'done' }, true, CONFIG)),
    ).toBe(null);
    expect(
      codeOf(() => assertCanReopen({ id: 1, status: 'done' }, false, CONFIG)),
    ).toBe(null);
    expect(
      codeOf(() => assertCanReopen({ id: 1, status: 'todo' }, true, CONFIG)),
    ).toBe(null);
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

describe('closingStatus (#57)', () => {
  test('defaults to the close status; cancelled to the cancel status', () => {
    expect(closingStatus(CONFIG)).toBe('done');
    expect(closingStatus(CONFIG, { cancelled: true })).toBe('cancelled');
    expect(closingStatus(CONFIG, { status: 'cancelled' })).toBe('cancelled');
  });

  test('uses the configured close/cancel statuses', () => {
    const config = {
      ...CONFIG,
      statuses: [
        { name: 'open', closed: false },
        { name: 'fixed', closed: true },
        { name: 'wontfix', closed: true },
      ],
      defaultStatus: 'open',
      closeStatus: 'fixed',
      cancelStatus: 'wontfix',
    };
    expect(closingStatus(config)).toBe('fixed');
    expect(closingStatus(config, { cancelled: true })).toBe('wontfix');
  });

  test('rejects open/unknown statuses, status + cancelled, and a missing cancel status', () => {
    for (const status of ['todo', 'bogus', 3]) {
      expect(codeOf(() => closingStatus(CONFIG, { status }))).toBe(
        'invalid_input',
      );
    }
    expect(
      codeOf(() => closingStatus(CONFIG, { status: 'done', cancelled: true })),
    ).toBe('invalid_input');
    const noCancel = {
      ...CONFIG,
      statuses: CONFIG.statuses.filter((s) => s.name !== 'cancelled'),
    };
    expect(() => closingStatus(noCancel, { cancelled: true })).toThrow(
      'No cancel status is configured',
    );
  });

  test('closed/open is judged by the configured definitions', () => {
    const config = {
      ...CONFIG,
      statuses: [
        { name: 'open', closed: false },
        { name: 'done', closed: false },
        { name: 'shipped', closed: true },
      ],
      defaultStatus: 'open',
    };
    // `done` is open here, so a done issue in closed/ may be closed (repair).
    expect(
      codeOf(() => assertCanClose({ id: 1, status: 'done' }, true, config)),
    ).toBe(null);
    expect(
      codeOf(() => assertCanClose({ id: 1, status: 'shipped' }, true, config)),
    ).toBe('invalid_state');
    expect(reopenStatus(config, 'done')).toBe('done');
  });
});
