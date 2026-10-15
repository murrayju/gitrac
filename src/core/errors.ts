/**
 * Structured errors shared by every layer. The CLI's top-level handler
 * (`src/cli/errors.ts`) turns a {@link GitracError} into `Error: <message>`
 * (human) or `{"error":{"code","message",...}}` (json/yaml) on stderr and
 * exits with {@link GitracError.exitCode}. Exit codes are part of the public
 * CLI contract (documented in the skill and design spec): keep them stable.
 */

/** Unexpected / general failure (also: invalid config file, server errors). */
export const EXIT_GENERAL = 1;
/**
 * Bad arguments, flags, or field values (including CLI usage errors), or a
 * destructive command (`delete`) that wasn't confirmed.
 */
export const EXIT_INVALID_INPUT = 2;
/**
 * The request conflicts with the issue's / repo's current state. For `claim`
 * and `unclaim` this means the issue is claimed by someone else (`--force`
 * overrides); also used for e.g. `init` on an initialized repo.
 */
export const EXIT_CONFLICT = 3;
/** `claim` / `unclaim`: the issue is claimed by someone else (= {@link EXIT_CONFLICT}). */
export const EXIT_ALREADY_CLAIMED = EXIT_CONFLICT;
/** `claim` / `unclaim` on a closed (`done` / `cancelled`) issue. */
export const EXIT_ISSUE_CLOSED = 4;
/** The issue (or other named thing) does not exist. */
export const EXIT_NOT_FOUND = 5;
/** Timed out waiting for the repo-wide gitrac lock (safe to retry). */
export const EXIT_LOCK_TIMEOUT = 6;
/** A git command (commit, push, ...) failed. */
export const EXIT_GIT = 7;
/** Not inside a git work tree, or gitrac is not initialized (`gitrac init`). */
export const EXIT_NOT_A_PROJECT = 8;

/** Machine-readable error codes (the `code` field of JSON error output). */
export const ERROR_EXIT_CODES = {
  error: EXIT_GENERAL,
  invalid_config: EXIT_GENERAL,
  server_error: EXIT_GENERAL,
  invalid_input: EXIT_INVALID_INPUT,
  usage: EXIT_INVALID_INPUT,
  confirmation_required: EXIT_INVALID_INPUT,
  already_claimed: EXIT_CONFLICT,
  already_initialized: EXIT_CONFLICT,
  invalid_state: EXIT_CONFLICT,
  duplicate_issue: EXIT_CONFLICT,
  issue_closed: EXIT_ISSUE_CLOSED,
  not_found: EXIT_NOT_FOUND,
  lock_timeout: EXIT_LOCK_TIMEOUT,
  git_error: EXIT_GIT,
  not_a_git_repo: EXIT_NOT_A_PROJECT,
  not_initialized: EXIT_NOT_A_PROJECT,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_EXIT_CODES;

/** Extra machine-readable fields merged into the JSON error object. */
export type ErrorDetails = Record<string, unknown>;

/** An error with a stable machine-readable code and exit code. */
export class GitracError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: ErrorDetails; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : {});
    this.name = 'GitracError';
    this.code = code;
    this.details = options.details;
  }

  /** The process exit code for this error. */
  get exitCode(): number {
    return ERROR_EXIT_CODES[this.code];
  }
}

/** `Issue #<id> not found` ({@link EXIT_NOT_FOUND}). */
export function issueNotFound(id: number): GitracError {
  return new GitracError('not_found', `Issue #${id} not found`, {
    details: { id },
  });
}

/**
 * More than one file on disk claims issue `id` (`files`: repo-relative paths,
 * e.g. a hand-renamed title left the old file behind). Reported instead of
 * silently picking one ({@link EXIT_CONFLICT}).
 */
export function duplicateIssue(id: number, files: string[]): GitracError {
  return new GitracError(
    'duplicate_issue',
    `Issue #${id} has ${files.length} files: ${files.join(', ')}. Keep one (merge any changes into it) and delete the others.`,
    { details: { id, files } },
  );
}

/**
 * Invalid user input ({@link EXIT_INVALID_INPUT}). With several messages, the
 * human output prints one `Error:` line per message and the JSON output
 * carries them as `errors: [...]`.
 */
export function invalidInput(messages: string | string[]): GitracError {
  const list = Array.isArray(messages) ? messages : [messages];
  return new GitracError(
    'invalid_input',
    list.join('; '),
    list.length > 1 ? { details: { errors: list } } : {},
  );
}

/** Parse a numeric issue ID argument, throwing `invalid_input` if it isn't one. */
export function parseIssueIdArg(value: string): number {
  const trimmed = value.trim();
  if (!/^#?\d+$/.test(trimmed)) {
    throw invalidInput(`Invalid issue ID "${value}".`);
  }
  return Number.parseInt(trimmed.replace(/^#/, ''), 10);
}
