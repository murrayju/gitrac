import { invalidInput } from '../core/errors.ts';

/**
 * Throw an `invalid_input` error carrying every validation message (printed
 * one `Error:` line each, or as `errors: [...]` in JSON) — exit code
 * `EXIT_INVALID_INPUT`. Safe inside `withMutationLock`: the lock is released
 * as the error propagates.
 */
export function throwValidationErrors(errors: string[]): never {
  throw invalidInput(errors);
}
