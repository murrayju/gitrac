import { CommanderError } from 'commander';
import yaml from 'js-yaml';
import { GitError } from 'simple-git';
import { type ErrorCode, GitracError } from '../core/errors.ts';
import type { OutputFormat } from '../core/types.ts';

const OUTPUT_FORMATS: readonly OutputFormat[] = ['human', 'json', 'yaml'];

/** The JSON shape printed to stderr in json/yaml mode. */
export interface ErrorPayload {
  error: { code: ErrorCode; message: string; [key: string]: unknown };
}

/**
 * Normalize anything thrown by a command into a {@link GitracError}:
 * typed errors pass through, simple-git failures become `git_error`,
 * Commander usage errors become `usage`, and anything else becomes a generic
 * `error` with the original message (the original is kept as `cause`).
 */
export function toGitracError(err: unknown): GitracError {
  if (err instanceof GitracError) return err;
  if (err instanceof GitError) {
    const detail = err.message.trim() || 'unknown error';
    return new GitracError('git_error', `git failed: ${detail}`, {
      cause: err,
    });
  }
  if (err instanceof CommanderError) {
    return new GitracError(
      'usage',
      err.message.replace(/^error:\s*/i, '').trim(),
      { details: { reason: err.code }, cause: err },
    );
  }
  if (err instanceof Error) {
    return new GitracError('error', err.message || String(err), { cause: err });
  }
  return new GitracError('error', String(err));
}

/**
 * Append a CLI hint (e.g. which flag overrides the error) to a service
 * error's message, keyed by error code. Service messages are
 * surface-neutral; the adapter knows its own flags. Returns `err` unchanged
 * if it isn't a {@link GitracError} or has no hint; otherwise a copy with the
 * same code, details and cause. Use as `promise.catch((e) => { throw withHint(e, …) })`.
 */
export function withHint(
  err: unknown,
  hints: Partial<Record<ErrorCode, string>>,
): unknown {
  if (!(err instanceof GitracError)) return err;
  const hint = hints[err.code];
  if (!hint) return err;
  return new GitracError(err.code, `${err.message} ${hint}`, {
    details: err.details,
    cause: err,
  });
}

/** The machine-readable error object for json/yaml output. */
export function errorPayload(err: GitracError): ErrorPayload {
  // code and message come first and are never overridden by details.
  const base = { code: err.code, message: err.message };
  return { error: Object.assign({ ...base }, err.details, base) };
}

/**
 * Render an error for stderr (without trailing newline).
 *
 * - human: `Error: <message>` (one line per message for multi-error input)
 * - json: a single-line `{"error":{"code":...,"message":...}}` object
 * - yaml: the same object as YAML
 *
 * With `debug`, the stack trace (and that of any `cause`) is appended.
 */
export function formatError(
  err: GitracError,
  format: OutputFormat,
  options: { debug?: boolean } = {},
): string {
  let out: string;
  if (format === 'json') {
    out = JSON.stringify(errorPayload(err));
  } else if (format === 'yaml') {
    out = yaml.dump(errorPayload(err), { lineWidth: -1 }).trimEnd();
  } else {
    const errors = err.details?.errors;
    const messages =
      Array.isArray(errors) && errors.length > 0
        ? errors.map(String)
        : [err.message];
    out = messages.map((m) => `Error: ${m}`).join('\n');
  }
  if (options.debug) {
    out = `${debugTrace(err)}\n${out}`;
  }
  return out;
}

function debugTrace(err: GitracError): string {
  const parts = [err.stack ?? String(err)];
  let cause: unknown = err.cause;
  while (cause instanceof Error) {
    parts.push(`Caused by: ${cause.stack ?? cause.message}`);
    cause = cause.cause;
  }
  return parts.join('\n');
}

/**
 * Determine `-o/--output` and `--debug` straight from argv. Used when an error
 * happens before (or during) Commander's option parsing, so the handler can
 * still honor them. The last `-o` wins, like Commander.
 */
export function scanErrorOptions(argv: readonly string[]): {
  format: OutputFormat;
  debug: boolean;
} {
  let format: string | undefined;
  let debug = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--') break;
    if (arg === '--debug') debug = true;
    else if (arg === '-o' || arg === '--output') format = argv[++i];
    else if (arg.startsWith('--output=')) format = arg.slice(9);
    else if (/^-o./.test(arg)) format = arg.slice(2).replace(/^=/, '');
  }
  return {
    format: OUTPUT_FORMATS.includes(format as OutputFormat)
      ? (format as OutputFormat)
      : 'human',
    debug,
  };
}

const SILENT_COMMANDER_CODES = new Set([
  'commander.help',
  'commander.helpDisplayed',
  'commander.version',
]);

/**
 * Print `err` to stderr in the requested format and return its exit code.
 * Commander's help/version exits print nothing more.
 */
export function reportError(
  err: unknown,
  options: { format: OutputFormat; debug: boolean },
): number {
  if (err instanceof CommanderError && SILENT_COMMANDER_CODES.has(err.code)) {
    // Help / version output was already written by Commander.
    return err.exitCode;
  }
  const typed = toGitracError(err);
  process.stderr.write(`${formatError(typed, options.format, options)}\n`);
  return typed.exitCode;
}
