/**
 * Finding `#N` issue references in rendered text (pure; no DOM).
 *
 * Used to linkify references when rendering markdown — the stored markdown is
 * never changed. Callers pass plain text that is already outside code spans,
 * code blocks and links (see `issue-link-plugin.ts`); this module applies the
 * rules within that text:
 *
 * - `#` + a positive integer without a leading zero (`#3`, `#120`).
 * - Word-bounded: not preceded by a letter/digit/`_` (`abc#3`), `#` (`##3`),
 *   `&` (`&#38;` entities) or `/` (`/#3` URL fragments), and not followed by
 *   a word character (`#3a`, `#3_x`) or by `-`/`.` + a word character
 *   (`#3-setup` heading anchors, `#3.5`). Trailing punctuation is fine
 *   (`(#3)`, `#3.`, `#3,`).
 * - Not inside a URL (`https://example.com/page#3`, `www.x.org/?a=1#3`).
 */

export interface IssueRefMatch {
  /** Offset of the `#` in the text. */
  start: number;
  /** Offset just past the last digit. */
  end: number;
  id: number;
}

const REF_PATTERN =
  /(?<![\p{L}\p{N}_#&/])#([1-9]\d*)(?![\p{L}\p{N}_]|[-.][\p{L}\p{N}_])/gu;

/** A bare URL (or `www.` host) up to the next whitespace. */
const URL_PATTERN = /\b(?:[a-z][a-z\d+.-]*:\/\/|www\.|mailto:)\S*/giu;

/** The `#N` issue references in `text`, in order. */
export function findIssueRefs(text: string): IssueRefMatch[] {
  if (!text.includes('#')) return [];
  const urls: [number, number][] = [];
  for (const m of text.matchAll(URL_PATTERN)) {
    urls.push([m.index, m.index + m[0].length]);
  }
  const refs: IssueRefMatch[] = [];
  for (const m of text.matchAll(REF_PATTERN)) {
    const start = m.index;
    const end = start + m[0].length;
    if (urls.some(([from, to]) => start >= from && start < to)) continue;
    const id = Number(m[1]);
    if (!Number.isSafeInteger(id)) continue;
    refs.push({ start, end, id });
  }
  return refs;
}

/** The in-app path of issue `id`. */
export function issuePath(id: number): string {
  return `/issues/${id}`;
}
