/**
 * Parsing the issue numbers typed into the dependency editor (pure; no DOM).
 *
 * Each ID is a positive integer, with or without a leading `#` (`12`, `#12`).
 * A list separates IDs with commas and/or whitespace (`#3, #4 5`).
 */

/** Parsed input: the IDs (ascending, no duplicates), or why it is invalid. */
export type ParsedIssueIds =
  | { ok: true; ids: number[] }
  | { ok: false; error: string };

const ID_PATTERN = /^#?([1-9]\d*)$/;

/** One issue ID (`12` or `#12`), or null if `text` is not one. */
export function parseIssueId(text: string): number | null {
  const match = ID_PATTERN.exec(text.trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

/** One or more issue IDs separated by commas or whitespace. */
export function parseIssueIds(text: string): ParsedIssueIds {
  const tokens = text.split(/[\s,]+/).filter((t) => t !== '');
  if (tokens.length === 0) {
    return { ok: false, error: 'Enter an issue number, e.g. #12' };
  }
  const ids = new Set<number>();
  for (const token of tokens) {
    const id = parseIssueId(token);
    if (id === null) {
      return { ok: false, error: `Not an issue number: ${token}` };
    }
    ids.add(id);
  }
  return { ok: true, ids: [...ids].sort((a, b) => a - b) };
}

/** Exactly one issue ID (for the parent). */
export function parseSingleIssueId(text: string): ParsedIssueIds {
  const parsed = parseIssueIds(text);
  if (parsed.ok && parsed.ids.length > 1) {
    return { ok: false, error: 'Enter only one issue number' };
  }
  return parsed;
}
