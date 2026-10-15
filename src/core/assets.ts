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

/**
 * Whether `name` (e.g. from {@link extractAssetRefs}) is a plain filename
 * inside `.issues/assets/` — no directory separators or `..` — so it is safe
 * to join onto the assets directory (e.g. to delete it).
 */
export function isAssetFilename(name: string): boolean {
  return (
    name.length > 0 &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('\0') &&
    !name.includes('..')
  );
}
