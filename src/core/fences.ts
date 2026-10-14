/**
 * Minimal fenced-code-block detection for the line-oriented parts of the
 * issue file format (description/comments splitting and heading escaping).
 *
 * Follows CommonMark closely enough for our purposes:
 * - Fences open with 3+ backticks or 3+ tildes, optionally indented.
 * - Backtick fence info strings may not contain backticks.
 * - A fence is closed only by a line of the same character, at least as long
 *   as the opener, with nothing but whitespace after it.
 *
 * Indentation is not limited to 3 spaces so that fences nested inside list
 * items (as emitted by editors) are recognized too.
 */

export interface Fence {
  char: '`' | '~';
  length: number;
}

const OPEN_FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
const CLOSE_FENCE_RE = /^\s*(`{3,}|~{3,})\s*$/;

/** Return the fence opened by `line`, or null if it is not a fence opener. */
export function openFence(line: string): Fence | null {
  const match = line.match(OPEN_FENCE_RE);
  const marker = match?.[1];
  if (!marker) {
    return null;
  }
  const char = marker[0] === '`' ? '`' : '~';
  if (char === '`' && (match[2] ?? '').includes('`')) {
    return null;
  }
  return { char, length: marker.length };
}

/** True if `line` closes the given open fence. */
export function closesFence(line: string, fence: Fence): boolean {
  const marker = line.match(CLOSE_FENCE_RE)?.[1];
  return (
    marker !== undefined &&
    marker[0] === fence.char &&
    marker.length >= fence.length
  );
}

/** Per-line classification produced by {@link scanFences}. */
export type LineKind = 'text' | 'fence' | 'code';

/**
 * Classify each line as normal text, a fence delimiter, or fenced code
 * content. Also returns the fence left open at the end, if any.
 */
export function scanFences(lines: string[]): {
  kinds: LineKind[];
  open: Fence | null;
} {
  const kinds: LineKind[] = [];
  let open: Fence | null = null;
  for (const line of lines) {
    if (open) {
      if (closesFence(line, open)) {
        open = null;
        kinds.push('fence');
      } else {
        kinds.push('code');
      }
      continue;
    }
    const fence = openFence(line);
    if (fence) {
      open = fence;
      kinds.push('fence');
    } else {
      kinds.push('text');
    }
  }
  return { kinds, open };
}
