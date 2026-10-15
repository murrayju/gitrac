import { describe, expect, test } from 'bun:test';
import { CommanderError } from 'commander';
import yaml from 'js-yaml';
import { GitError } from 'simple-git';
import {
  EXIT_GENERAL,
  EXIT_GIT,
  EXIT_INVALID_INPUT,
  EXIT_LOCK_TIMEOUT,
  EXIT_NOT_A_PROJECT,
  GitracError,
  invalidInput,
} from '../core/errors.ts';
import { LockTimeoutError } from '../fs/lock.ts';
import {
  errorPayload,
  formatError,
  scanErrorOptions,
  toGitracError,
} from './errors.ts';
import { ProjectRootError } from './global-options.ts';

/** Regression tests for #46: the CLI's single top-level error handler. */

describe('toGitracError', () => {
  test('passes typed errors through', () => {
    const err = new GitracError('not_found', 'x');
    expect(toGitracError(err)).toBe(err);
  });

  test('simple-git failures are git_error', () => {
    const err = toGitracError(new GitError(undefined, 'fatal: bad thing\n'));
    expect(err.code).toBe('git_error');
    expect(err.exitCode).toBe(EXIT_GIT);
    expect(err.message).toBe('git failed: fatal: bad thing');
  });

  test('Commander usage errors are usage (invalid input)', () => {
    const err = toGitracError(
      new CommanderError(
        1,
        'commander.unknownOption',
        "error: unknown option '--x'",
      ),
    );
    expect(err.code).toBe('usage');
    expect(err.exitCode).toBe(EXIT_INVALID_INPUT);
    expect(err.message).toBe("unknown option '--x'");
  });

  test('lock timeouts and project-root errors are typed', () => {
    expect(toGitracError(new LockTimeoutError('/l', null, 5)).exitCode).toBe(
      EXIT_LOCK_TIMEOUT,
    );
    const root = toGitracError(new ProjectRootError('nope', 'not-a-git-repo'));
    expect(root.code).toBe('not_a_git_repo');
    expect(root.exitCode).toBe(EXIT_NOT_A_PROJECT);
  });

  test('anything else is a general error keeping the message', () => {
    const cause = new Error('ENOENT: no such file');
    const err = toGitracError(cause);
    expect(err.code).toBe('error');
    expect(err.exitCode).toBe(EXIT_GENERAL);
    expect(err.message).toBe('ENOENT: no such file');
    expect(err.cause).toBe(cause);
    expect(toGitracError('weird').message).toBe('weird');
  });
});

describe('formatError', () => {
  const notFound = new GitracError('not_found', 'Issue #9 not found', {
    details: { id: 9, code: 'ignored' },
  });

  test('human: Error: <message>, no stack', () => {
    expect(formatError(notFound, 'human')).toBe('Error: Issue #9 not found');
    expect(formatError(invalidInput(['a', 'b']), 'human')).toBe(
      'Error: a\nError: b',
    );
  });

  test('json: one parseable line with code and message', () => {
    const out = formatError(notFound, 'json');
    expect(out).not.toContain('\n');
    expect(JSON.parse(out)).toEqual({
      error: { code: 'not_found', message: 'Issue #9 not found', id: 9 },
    });
    expect(JSON.parse(formatError(invalidInput(['a', 'b']), 'json'))).toEqual({
      error: { code: 'invalid_input', message: 'a; b', errors: ['a', 'b'] },
    });
  });

  test('yaml: the same object', () => {
    expect(yaml.load(formatError(notFound, 'yaml'))).toEqual(
      errorPayload(notFound),
    );
  });

  test('stack traces only with debug', () => {
    expect(formatError(notFound, 'human')).not.toMatch(/^\s+at /m);
    const out = formatError(toGitracError(new Error('boom')), 'json', {
      debug: true,
    });
    expect(out).toMatch(/^\s+at /m);
    expect(out).toContain('Caused by: Error: boom');
    // The JSON error is still the last line.
    expect(JSON.parse(out.split('\n').at(-1) as string).error.message).toBe(
      'boom',
    );
  });
});

describe('scanErrorOptions', () => {
  test.each([
    [[], 'human', false],
    [['-o', 'json', 'show', 'x'], 'json', false],
    [['show', '--output', 'yaml'], 'yaml', false],
    [['--output=json', '--debug'], 'json', true],
    [['-ojson'], 'json', false],
    [['-o', 'xml'], 'human', false],
    [['-o', 'json', '-o', 'yaml'], 'yaml', false],
    [['comment', '1', '--', '-o', 'json', '--debug'], 'human', false],
  ] as const)('%j', (argv, format, debug) => {
    expect(scanErrorOptions(argv)).toEqual({ format, debug });
  });
});
