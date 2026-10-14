import { scanFences } from './fences.ts';
import type { Comment } from './types.ts';

/** Matches a comment header line: `### {author} — {timestamp}` (em dash). */
export const COMMENT_HEADER_RE = /^### (.+?) \u2014 (.+)$/;

/**
 * True if `line` is a comment header, optionally preceded by any number of
 * escaping backslashes.
 */
export function isCommentHeaderLike(line: string): boolean {
  return COMMENT_HEADER_RE.test(line.replace(/^\\+/, ''));
}

/** Prefix a backslash to header-like lines (injective; see unescape). */
export function escapeCommentHeaderLine(line: string): string {
  return isCommentHeaderLike(line) ? `\\${line}` : line;
}

/** Inverse of {@link escapeCommentHeaderLine}. */
export function unescapeCommentHeaderLine(line: string): string {
  return line.startsWith('\\') && isCommentHeaderLike(line)
    ? line.slice(1)
    : line;
}

/**
 * Escape a comment body so that no line can be mistaken for a comment header.
 *
 * - Outside code fences, heading markers (`#`) at the start of lines are
 *   escaped with a backslash (`## x` -> `\## x`). Lines that already start
 *   with backslashes followed by a heading marker get one more backslash, so
 *   the escaping is reversible for any input.
 * - Inside code fences, only lines that look like a comment header are
 *   escaped (same backslash scheme), since those would otherwise split the
 *   comment when parsed.
 */
export function escapeCommentHeadings(body: string): string {
  return transformLines(
    body,
    (line) => line.replace(/^(\\*#{1,6}\s)/, '\\$1'),
    escapeCommentHeaderLine,
  );
}

/** Inverse of {@link escapeCommentHeadings}. */
export function unescapeCommentHeadings(body: string): string {
  return transformLines(
    body,
    (line) => line.replace(/^\\(\\*#{1,6}\s)/, '$1'),
    unescapeCommentHeaderLine,
  );
}

/**
 * Apply `text` to lines outside code fences and `code` to fenced code
 * content. Fence delimiter lines are left untouched, so the fence structure
 * is identical before and after escaping.
 */
function transformLines(
  text: string,
  transformText: (line: string) => string,
  transformCode: (line: string) => string,
): string {
  const lines = text.split('\n');
  const { kinds } = scanFences(lines);
  return lines
    .map((line, i) => {
      switch (kinds[i]) {
        case 'text':
          return transformText(line);
        case 'code':
          return transformCode(line);
        default:
          return line;
      }
    })
    .join('\n');
}

/**
 * Parse a comments section into structured Comment objects.
 * Comments are separated by `### {author} — {timestamp}` headers (em dash U+2014).
 * Callers must pass a section that starts with a header line; `parseIssue`
 * guarantees this, so no content before the first header is ever dropped.
 */
export function parseComments(commentsSection: string): Comment[] {
  if (!commentsSection.trim()) {
    return [];
  }

  const lines = commentsSection.split('\n');
  const comments: Comment[] = [];
  let currentAuthor: string | null = null;
  let currentTimestamp: string | null = null;
  let bodyLines: string[] = [];

  for (const line of lines) {
    const match = line.match(COMMENT_HEADER_RE);
    if (match) {
      // Save previous comment if any
      if (currentAuthor !== null && currentTimestamp !== null) {
        comments.push({
          author: currentAuthor,
          timestamp: currentTimestamp,
          body: unescapeCommentHeadings(trimBody(bodyLines)),
        });
      }
      currentAuthor = match[1] ?? '';
      currentTimestamp = match[2] ?? '';
      bodyLines = [];
    } else {
      bodyLines.push(line);
    }
  }

  // Save last comment
  if (currentAuthor !== null && currentTimestamp !== null) {
    comments.push({
      author: currentAuthor,
      timestamp: currentTimestamp,
      body: unescapeCommentHeadings(trimBody(bodyLines)),
    });
  }

  return comments;
}

/**
 * Serialize Comment objects back to the markdown comments section.
 */
export function serializeComments(comments: Comment[]): string {
  return comments
    .map((c) => {
      const header = `### ${c.author} \u2014 ${c.timestamp}`;
      const escapedBody = escapeCommentHeadings(c.body);
      return `${header}\n\n${escapedBody}`;
    })
    .join('\n\n');
}

/**
 * Trim leading/trailing empty lines from body lines and join.
 */
function trimBody(lines: string[]): string {
  // Remove leading empty line (the blank line after the header)
  let start = 0;
  while (start < lines.length && (lines[start] ?? '').trim() === '') {
    start++;
  }
  let end = lines.length - 1;
  while (end >= start && (lines[end] ?? '').trim() === '') {
    end--;
  }
  return lines.slice(start, end + 1).join('\n');
}
