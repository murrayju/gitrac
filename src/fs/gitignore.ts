import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * `.issues/.gitignore`: keeps files gitrac writes under `.issues/` that must
 * never be committed out of git — the web UI's new-issue drafts
 * (`.issues/drafts/*.json`). gitrac's lock, ID high-water mark and temp files
 * live in the git dir (or the OS temp dir), not under `.issues/`, so they
 * need no entry.
 */

/** Repo-relative path of the ignore file. */
export const ISSUES_GITIGNORE_PATH = join('.issues', '.gitignore');

/** Patterns `.issues/.gitignore` must contain (relative to `.issues/`). */
export const ISSUES_GITIGNORE_LINES = ['drafts/'] as const;

const HEADER = '# Local gitrac files (web UI drafts); never commit these.';

/** Compare patterns ignoring an anchoring `/` and a trailing `/`. */
function normalize(line: string): string {
  return line.trim().replace(/^\//, '').replace(/\/$/, '');
}

/**
 * Ensure `.issues/.gitignore` contains {@link ISSUES_GITIGNORE_LINES},
 * creating it or appending what's missing (existing lines are kept).
 * Idempotent; returns true if the file was written.
 */
export async function writeIssuesGitignore(dir: string): Promise<boolean> {
  const file = join(dir, ISSUES_GITIGNORE_PATH);
  let existing = '';
  try {
    existing = await readFile(file, 'utf-8');
  } catch {
    // missing: create it
  }
  const present = new Set(existing.split(/\r?\n/).map(normalize));
  const missing = ISSUES_GITIGNORE_LINES.filter(
    (l) => !present.has(normalize(l)),
  );
  if (missing.length === 0) return false;
  const lines = existing ? [existing.replace(/\n?$/, '')] : [HEADER];
  await writeFile(file, `${[...lines, ...missing].join('\n')}\n`);
  return true;
}
