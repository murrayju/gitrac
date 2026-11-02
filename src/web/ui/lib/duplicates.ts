import { ApiError, type DuplicateFile, type DuplicateIssueId } from '../api.ts';

/** A file of a duplicated ID and what the fix does to it. */
export interface PlannedFile {
  file: DuplicateFile;
  /** The previewed new ID, or null if the file keeps the ID. */
  newId: number | null;
}

/**
 * What resolving `duplicate` with `keep` does: `keep` keeps the ID and the
 * other files get the previewed new IDs in order, as the server renumbers
 * them. An unknown `keep` falls back to the suggestion.
 */
export function renumberPlan(
  duplicate: DuplicateIssueId,
  keep: string,
): PlannedFile[] {
  const kept = duplicate.files.some((f) => f.path === keep)
    ? keep
    : duplicate.keep;
  let next = 0;
  return duplicate.files.map((file) => ({
    file,
    newId: file.path === kept ? null : (duplicate.newIds[next++] ?? null),
  }));
}

/** The server's `error` message in `err` (an API error body), else its message. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const { error } = JSON.parse(err.body) as { error?: unknown };
      if (typeof error === 'string') return error;
    } catch {
      // Not a JSON body: use the generic message.
    }
  }
  return err instanceof Error ? err.message : String(err);
}
