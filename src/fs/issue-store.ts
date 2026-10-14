import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  createDefaultConfig,
  ensureLabelColors,
  parseConfig,
  serializeConfig,
} from '../core/config.ts';
import { parseIssue, serializeIssue } from '../core/issue.ts';
import { issueFilename, parseIssueId } from '../core/slug.ts';
import type { Config, Issue } from '../core/types.ts';

function issuesDir(dir: string): string {
  return join(dir, '.issues');
}

function closedDir(dir: string): string {
  return join(dir, '.issues', 'closed');
}

function configPath(dir: string): string {
  return join(issuesDir(dir), 'config.yaml');
}

/**
 * Read and parse the .issues/config.yaml file.
 */
export async function readConfig(dir: string): Promise<Config> {
  const content = await readFile(configPath(dir), 'utf-8');
  return parseConfig(content);
}

/**
 * Serialize and write the config to .issues/config.yaml.
 */
export async function writeConfig(dir: string, config: Config): Promise<void> {
  const yaml = serializeConfig(config);
  await writeFile(configPath(dir), yaml);
}

/**
 * Register any labels not yet in the config, assigning each a color, and
 * write the config if it changed. Re-reads the config from disk so it never
 * clobbers concurrent updates (callers hold the repo lock).
 * Returns the updated config if it was written, or null if nothing changed.
 */
export async function registerLabels(
  dir: string,
  labels: string[],
): Promise<Config | null> {
  const config = await readConfig(dir);
  if (labels.every((l) => config.labels[l])) return null;
  config.labels = ensureLabelColors(labels, config.labels);
  await writeConfig(dir, config);
  return config;
}

/**
 * List .md filenames in .issues/ (not closed/).
 */
export async function listIssueFiles(dir: string): Promise<string[]> {
  const entries = await readdir(issuesDir(dir));
  return entries.filter((f) => f.endsWith('.md'));
}

/**
 * List .md filenames in .issues/closed/.
 */
export async function listClosedIssueFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(closedDir(dir));
    return entries.filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

/**
 * List all .md filenames from both .issues/ and .issues/closed/.
 */
export async function listAllIssueFiles(dir: string): Promise<string[]> {
  const [open, closed] = await Promise.all([
    listIssueFiles(dir),
    listClosedIssueFiles(dir),
  ]);
  return [...open, ...closed];
}

/**
 * Find an issue file by its numeric ID prefix.
 * Searches open issues first, then closed.
 */
export async function findIssueFile(
  dir: string,
  id: number,
): Promise<{ filename: string; closed: boolean } | null> {
  const openFiles = await listIssueFiles(dir);
  for (const f of openFiles) {
    if (parseIssueId(f) === id) {
      return { filename: f, closed: false };
    }
  }
  const closedFiles = await listClosedIssueFiles(dir);
  for (const f of closedFiles) {
    if (parseIssueId(f) === id) {
      return { filename: f, closed: true };
    }
  }
  return null;
}

/**
 * Read the raw markdown of an issue file by its numeric ID, along with
 * where it lives. Returns null if no file exists for the ID.
 */
export async function readIssueContent(
  dir: string,
  id: number,
): Promise<{ content: string; filename: string; closed: boolean } | null> {
  const found = await findIssueFile(dir, id);
  if (!found) return null;
  const base = found.closed ? closedDir(dir) : issuesDir(dir);
  const content = await readFile(join(base, found.filename), 'utf-8');
  return { content, ...found };
}

/**
 * Read and parse an issue by its numeric ID.
 */
export async function readIssue(dir: string, id: number): Promise<Issue> {
  const raw = await readIssueContent(dir, id);
  if (!raw) {
    throw new Error(`Issue #${id} not found`);
  }
  return parseIssue(raw.content);
}

/**
 * Write an issue to the correct directory using the correct filename.
 * When `opts.closed` is true, writes to `.issues/closed/` instead of `.issues/`.
 * Returns the filename.
 */
export async function writeIssue(
  dir: string,
  issue: Issue,
  opts?: { closed?: boolean },
): Promise<string> {
  const filename = issueFilename(issue.id, issue.title);
  const content = serializeIssue(issue);
  const base = opts?.closed ? closedDir(dir) : issuesDir(dir);
  await writeFile(join(base, filename), content);
  return filename;
}

/**
 * Delete an issue file by filename.
 * When `closed` is true, deletes from `.issues/closed/`, otherwise from `.issues/`.
 * Silently ignores if the file doesn't exist.
 */
export async function deleteIssueFile(
  dir: string,
  filename: string,
  closed: boolean,
): Promise<void> {
  const base = closed ? closedDir(dir) : issuesDir(dir);
  try {
    await unlink(join(base, filename));
  } catch {
    // File may not exist — ignore
  }
}

/**
 * Move an issue to .issues/closed/.
 */
export async function moveToClose(dir: string, id: number): Promise<void> {
  const found = await findIssueFile(dir, id);
  if (!found || found.closed) {
    throw new Error(`Open issue #${id} not found`);
  }
  await rename(
    join(issuesDir(dir), found.filename),
    join(closedDir(dir), found.filename),
  );
}

/**
 * Move an issue from .issues/closed/ back to .issues/.
 */
export async function moveToReopen(dir: string, id: number): Promise<void> {
  const found = await findIssueFile(dir, id);
  if (!found?.closed) {
    throw new Error(`Closed issue #${id} not found`);
  }
  await rename(
    join(closedDir(dir), found.filename),
    join(issuesDir(dir), found.filename),
  );
}

/**
 * Initialize the .issues directory structure with a default config.
 * Throws if it already exists (unless force is true).
 */
export async function initIssuesDir(
  dir: string,
  options?: { force?: boolean },
): Promise<void> {
  const issDir = issuesDir(dir);
  const exists = await Bun.file(join(issDir, 'config.yaml')).exists();
  if (exists && !options?.force) {
    throw new Error('.issues directory already exists');
  }
  await mkdir(issDir, { recursive: true });
  await mkdir(closedDir(dir), { recursive: true });
  const config = createDefaultConfig();
  await writeConfig(dir, config);
}

/**
 * Allocate the next issue ID: reads config, returns the next free ID,
 * and writes back the incremented counter.
 *
 * The ID is never lower than one past the highest ID already used by an
 * issue file (open or closed), so a stale `nextId` (e.g. after a merge) can
 * never produce a duplicate.
 *
 * This is a read-modify-write of `config.yaml`: callers must hold the repo
 * lock (see `withRepoLock` in `src/git/lock.ts`) across allocation, writing
 * the issue file, and committing.
 */
export async function allocateNextId(dir: string): Promise<number> {
  const [config, files] = await Promise.all([
    readConfig(dir),
    listAllIssueFiles(dir),
  ]);
  let maxExisting = 0;
  for (const f of files) {
    const fileId = parseIssueId(f);
    if (fileId !== null && fileId > maxExisting) {
      maxExisting = fileId;
    }
  }
  const id = Math.max(config.nextId, maxExisting + 1);
  config.nextId = id + 1;
  await writeConfig(dir, config);
  return id;
}
