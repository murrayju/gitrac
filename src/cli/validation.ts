/**
 * Print validation errors (one per line, prefixed with `Error:`) and exit 1.
 * Safe to call inside `withMutationLock`: the lock is released on exit.
 */
export function exitWithErrors(errors: string[]): never {
  for (const err of errors) {
    console.error(`Error: ${err}`);
  }
  process.exit(1);
}
