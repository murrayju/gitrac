import type { Comment } from './types.ts';

const COMMENT_HEADER_RE = /^### (.+?) \u2014 (.+)$/;

/**
 * Escape heading markers (`#`) at the start of lines in comment body text,
 * but leave content inside code fences untouched.
 */
export function escapeCommentHeadings(body: string): string {
  return processOutsideCodeFences(body, (line) =>
    line.replace(/^(#{1,6}\s)/, '\\$1'),
  );
}

/**
 * Unescape heading markers (`\#`) at the start of lines in comment body text,
 * but leave content inside code fences untouched.
 */
export function unescapeCommentHeadings(body: string): string {
  return processOutsideCodeFences(body, (line) =>
    line.replace(/^\\(#{1,6}\s)/, '$1'),
  );
}

/**
 * Apply a line transformation only to lines outside of code fences.
 */
function processOutsideCodeFences(
  text: string,
  transformLine: (line: string) => string,
): string {
  const lines = text.split('\n');
  let inCodeFence = false;
  const result: string[] = [];

  for (const line of lines) {
    if (line.startsWith('```')) {
      inCodeFence = !inCodeFence;
      result.push(line);
    } else if (inCodeFence) {
      result.push(line);
    } else {
      result.push(transformLine(line));
    }
  }

  return result.join('\n');
}

/**
 * Parse a comments section into structured Comment objects.
 * Comments are separated by `### {author} — {timestamp}` headers (em dash U+2014).
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
