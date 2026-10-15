import { describe, expect, test } from 'bun:test';
import {
  ERROR_EXIT_CODES,
  EXIT_ALREADY_CLAIMED,
  EXIT_CONFLICT,
  EXIT_GENERAL,
  EXIT_GIT,
  EXIT_INVALID_INPUT,
  EXIT_ISSUE_CLOSED,
  EXIT_LOCK_TIMEOUT,
  EXIT_NOT_A_PROJECT,
  EXIT_NOT_FOUND,
  GitracError,
  invalidInput,
  issueNotFound,
  parseIssueIdArg,
} from './errors.ts';

/** Regression tests for #46: structured errors with stable exit codes. */

describe('exit codes', () => {
  test('are stable (documented public contract)', () => {
    expect({
      EXIT_GENERAL,
      EXIT_INVALID_INPUT,
      EXIT_CONFLICT,
      EXIT_ALREADY_CLAIMED,
      EXIT_ISSUE_CLOSED,
      EXIT_NOT_FOUND,
      EXIT_LOCK_TIMEOUT,
      EXIT_GIT,
      EXIT_NOT_A_PROJECT,
    }).toEqual({
      EXIT_GENERAL: 1,
      EXIT_INVALID_INPUT: 2,
      EXIT_CONFLICT: 3,
      EXIT_ALREADY_CLAIMED: 3,
      EXIT_ISSUE_CLOSED: 4,
      EXIT_NOT_FOUND: 5,
      EXIT_LOCK_TIMEOUT: 6,
      EXIT_GIT: 7,
      EXIT_NOT_A_PROJECT: 8,
    });
  });

  test('not found, invalid input, conflict and git failure are distinct', () => {
    const codes = [
      ERROR_EXIT_CODES.not_found,
      ERROR_EXIT_CODES.invalid_input,
      ERROR_EXIT_CODES.already_claimed,
      ERROR_EXIT_CODES.git_error,
      ERROR_EXIT_CODES.error,
    ];
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('GitracError', () => {
  test('derives its exit code from its code', () => {
    const err = new GitracError('git_error', 'boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.exitCode).toBe(EXIT_GIT);
    expect(err.message).toBe('boom');
  });

  test('issueNotFound', () => {
    const err = issueNotFound(7);
    expect(err.code).toBe('not_found');
    expect(err.exitCode).toBe(EXIT_NOT_FOUND);
    expect(err.message).toBe('Issue #7 not found');
    expect(err.details).toEqual({ id: 7 });
  });

  test('invalidInput keeps every message', () => {
    expect(invalidInput('nope').details).toBeUndefined();
    const err = invalidInput(['a', 'b']);
    expect(err.exitCode).toBe(EXIT_INVALID_INPUT);
    expect(err.message).toBe('a; b');
    expect(err.details).toEqual({ errors: ['a', 'b'] });
  });
});

describe('parseIssueIdArg', () => {
  test.each([
    ['1', 1],
    ['42', 42],
    ['#42', 42],
    [' 7 ', 7],
  ])('parses %j', (input, id) => {
    expect(parseIssueIdArg(input)).toBe(id);
  });

  test.each(['abc', '', '12abc', '-1', '1.5'])('rejects %j', (input) => {
    let caught: unknown;
    try {
      parseIssueIdArg(input);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GitracError);
    expect((caught as GitracError).code).toBe('invalid_input');
  });
});
