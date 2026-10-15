import { GitracError } from '../core/errors.ts';

/**
 * Invalid issue fields (or another validation failure reported as a list).
 * Same code, message and details as `invalidInput(errors)` — so the CLI
 * prints it identically — but keeps the list so the web API can always reply
 * `{ error, errors }` (HTTP 400), even for a single message.
 */
export class ValidationError extends GitracError {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(
      'invalid_input',
      errors.join('; '),
      errors.length > 1 ? { details: { errors: [...errors] } } : {},
    );
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * An issue file exists (or its directory listing failed) but couldn't be read
 * or parsed. Carries the underlying error's code (`error` for plain errors)
 * and message, so the CLI reports it exactly as before; the web API answers
 * 404, as if the issue didn't exist.
 */
export class IssueUnreadableError extends GitracError {
  readonly id: number;

  constructor(id: number, cause: unknown) {
    if (cause instanceof GitracError) {
      super(cause.code, cause.message, { details: cause.details, cause });
    } else {
      super(
        'error',
        cause instanceof Error ? cause.message || String(cause) : String(cause),
        { cause },
      );
    }
    this.name = 'IssueUnreadableError';
    this.id = id;
  }
}
