/**
 * Optimistic concurrency for issue mutations.
 *
 * An issue's version is a strong ETag derived from the raw bytes of its
 * markdown file, so *any* change to the file — from the web UI, the CLI, an
 * agent, a `git pull`, or a hand edit — produces a new version. Clients send
 * the version they based an edit on in `If-Match`; a mismatch means someone
 * else changed the issue in the meantime and the request is rejected with 409.
 */

/** Strong ETag (quoted SHA-1 of the file contents) for an issue file. */
export function issueETag(content: string): string {
  const hash = new Bun.CryptoHasher('sha1').update(content).digest('hex');
  return `"${hash}"`;
}

/**
 * Evaluate an `If-Match` request header against the resource's current ETag
 * (RFC 9110 §13.1.1, strong comparison). A missing/empty header always
 * matches, so clients that don't opt in keep last-writer-wins semantics.
 */
export function ifMatchSatisfied(
  header: string | undefined | null,
  etag: string,
): boolean {
  if (header === undefined || header === null) return true;
  const trimmed = header.trim();
  if (!trimmed) return true;
  if (trimmed === '*') return true;
  return trimmed
    .split(',')
    .map((tag) => tag.trim())
    .some((tag) => tag === etag);
}
