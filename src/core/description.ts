/**
 * Comparing issue descriptions for "did anything change?" (#90).
 *
 * An issue file stores its description trimmed (`parseIssueFile` trims the
 * body; leading/trailing whitespace and blank lines can't be represented),
 * and the web editor serializes a trailing empty paragraph — which Tiptap
 * appends after a final code block, list, quote, ... as soon as it is
 * clicked into — as nothing but trailing blank lines. So two descriptions
 * that differ only in leading/trailing whitespace are the same markdown.
 *
 * Deliberately conservative: whitespace *inside* the text (including
 * trailing spaces on a line, a markdown hard break) is significant.
 */

/** The description as an issue file would store it. */
export function normalizeDescription(text: string): string {
  return text.trim();
}

/** Whether two descriptions are the same markdown once stored. */
export function sameDescription(a: string, b: string): boolean {
  return normalizeDescription(a) === normalizeDescription(b);
}
