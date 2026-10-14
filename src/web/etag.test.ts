import { describe, expect, test } from 'bun:test';
import { ifMatchSatisfied, issueETag } from './etag.ts';

describe('issueETag', () => {
  test('is a quoted, content-derived strong ETag', () => {
    const a = issueETag('hello');
    expect(a).toMatch(/^"[0-9a-f]{40}"$/);
    expect(issueETag('hello')).toBe(a);
    expect(issueETag('hello!')).not.toBe(a);
  });
});

describe('ifMatchSatisfied', () => {
  const etag = issueETag('content');

  test('missing or empty header always matches', () => {
    expect(ifMatchSatisfied(undefined, etag)).toBe(true);
    expect(ifMatchSatisfied(null, etag)).toBe(true);
    expect(ifMatchSatisfied('  ', etag)).toBe(true);
  });

  test('* matches', () => {
    expect(ifMatchSatisfied('*', etag)).toBe(true);
  });

  test('exact tag (or one of a list) matches', () => {
    expect(ifMatchSatisfied(etag, etag)).toBe(true);
    expect(ifMatchSatisfied(`"other", ${etag}`, etag)).toBe(true);
  });

  test('different, unquoted, or weak tags do not match', () => {
    expect(ifMatchSatisfied('"other"', etag)).toBe(false);
    expect(ifMatchSatisfied(etag.slice(1, -1), etag)).toBe(false);
    expect(ifMatchSatisfied(`W/${etag}`, etag)).toBe(false);
  });
});
