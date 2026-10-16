/**
 * The ISO timestamp for a write that must supersede `after` (pure; no I/O).
 *
 * Returns `now` if it is later than every parseable timestamp in `after`,
 * else the latest of them plus 1 ms. The effective state of an issue is its
 * version with the strictly latest `updated` (see `src/core/elsewhere.ts`).
 * So a new version must be strictly later than the one it replaces and than
 * the versions on other branches and in other worktrees. This is necessary
 * when two writes occur in the same millisecond, or when another machine's
 * clock is ahead. The function ignores unparseable and missing values.
 */
export function nextTimestamp(
  after: readonly (string | undefined)[],
  now: number = Date.now(),
): string {
  let latest = Number.NEGATIVE_INFINITY;
  for (const value of after) {
    const ms = value === undefined ? Number.NaN : Date.parse(value);
    if (Number.isFinite(ms) && ms > latest) latest = ms;
  }
  return new Date(Math.max(now, latest + 1)).toISOString();
}
