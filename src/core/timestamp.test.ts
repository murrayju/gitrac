import { describe, expect, test } from 'bun:test';
import { isLater } from './elsewhere.ts';
import { nextTimestamp } from './timestamp.ts';

/** Regression tests for #94: a new version must supersede the old ones. */

const NOW = Date.parse('2026-01-02T00:00:00.000Z');

describe('nextTimestamp', () => {
  test('is now when now is later than every input', () => {
    expect(nextTimestamp([], NOW)).toBe('2026-01-02T00:00:00.000Z');
    expect(nextTimestamp(['2026-01-01T23:59:59.999Z'], NOW)).toBe(
      '2026-01-02T00:00:00.000Z',
    );
  });

  test('a timestamp in the same millisecond gets 1 ms more', () => {
    const next = nextTimestamp(['2026-01-02T00:00:00.000Z'], NOW);
    expect(next).toBe('2026-01-02T00:00:00.001Z');
    expect(isLater(next, '2026-01-02T00:00:00.000Z')).toBe(true);
  });

  test('a future-dated timestamp (clock skew) gets 1 ms more', () => {
    expect(
      nextTimestamp(
        [
          '2026-01-01T00:00:00Z',
          '2026-01-02T00:05:00Z',
          '2026-01-02T00:01:00Z',
        ],
        NOW,
      ),
    ).toBe('2026-01-02T00:05:00.001Z');
  });

  test('sub-millisecond input is still superseded', () => {
    const next = nextTimestamp(['2026-01-02T00:00:00.0009Z'], NOW);
    expect(isLater(next, '2026-01-02T00:00:00.0009Z')).toBe(true);
  });

  test('ignores unparseable and missing values', () => {
    expect(nextTimestamp(['', 'not a date', undefined], NOW)).toBe(
      '2026-01-02T00:00:00.000Z',
    );
    expect(
      nextTimestamp(['garbage', '2026-01-02T00:00:00.000Z', undefined], NOW),
    ).toBe('2026-01-02T00:00:00.001Z');
  });

  test('defaults now to the current time', () => {
    const before = Date.now();
    const next = Date.parse(nextTimestamp([]));
    expect(next).toBeGreaterThanOrEqual(before);
    expect(next).toBeLessThanOrEqual(Date.now());
  });
});
