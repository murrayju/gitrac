/**
 * Extract asset filenames referenced in markdown content.
 * Matches patterns like `/.issues/assets/<filename>` or
 * `![...](/.issues/assets/<filename>)` in the markdown.
 */
export function extractAssetRefs(markdown: string): string[] {
  const pattern = /\/\.issues\/assets\/([^\s)"']+)/g;
  const refs = new Set<string>();
  for (const match of markdown.matchAll(pattern)) {
    if (match[1]) {
      refs.add(match[1]);
    }
  }
  return [...refs];
}
