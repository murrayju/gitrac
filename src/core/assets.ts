/**
 * Extract asset filenames referenced in markdown content.
 * Matches patterns like `/api/issues/assets/<filename>` or
 * `![...](/api/issues/assets/<filename>)` in the markdown.
 */
export function extractAssetRefs(markdown: string): string[] {
  const pattern = /\/api\/issues\/assets\/([^\s)"']+)/g;
  const refs = new Set<string>();
  for (const match of markdown.matchAll(pattern)) {
    if (match[1]) {
      refs.add(match[1]);
    }
  }
  return [...refs];
}
