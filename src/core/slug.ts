/**
 * Convert a title string to a URL-friendly slug.
 * Lowercase, replace non-alphanumeric with hyphens, collapse multiple hyphens, trim.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Generate an issue filename from id and title.
 */
export function issueFilename(id: number, title: string): string {
  return `${id}-${slugify(title)}.md`;
}

/**
 * Extract the leading integer id from an issue filename.
 * Returns null if filename doesn't match the expected pattern.
 */
export function parseIssueId(filename: string): number | null {
  const match = filename.match(/^(\d+)-/);
  if (!match?.[1]) return null;
  return Number.parseInt(match[1], 10);
}
