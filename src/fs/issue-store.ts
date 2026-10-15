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
import { duplicateIssue, GitracError, issueNotFound } from '../core/errors.ts';
import { parseIssue, serializeIssue } from '../core/issue.ts';
import { issueFilename, parseIssueId } from '../core/slug.ts';
import type { Config, Issue } from '../core/types.ts';

function issuesDir(dir: string): string {
  return join(dir, '.issues');
}

function closedDir(dir: string): string {
  return join(dir, '.issues', 'closed');
}

/** Repo-relative path of an issue file (`.issues/[closed/]<filename>`). */
function issueRelPath(filename: string, closed: boolean): string {
  return closed
    ? join('.issues', 'closed', filename)
    : join('.issues', filename);
}

function configPath(dir: string): string {
  return join(issuesDir(dir), 'config.yaml');
}

/**
 * Read and parse the .issues/config.yaml file. Throws a `GitracError` with
 * code `not_initialized` if it doesn't exist, or `invalid_config` if it can't
 * be parsed.
 */
export async function readConfig(dir: string): Promise<Config> {
  let content: string;
  try {
    content = await readFile(configPath(dir), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new GitracError(
        'not_initialized',
        `gitrac is not initialized in ${dir} (no .issues/config.yaml). Run "gitrac init" to set it up.`,
        { cause: err },
      );
    }
    throw err;
  }
  try {
    return parseConfig(content);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new GitracError(
      'invalid_config',
      `Invalid .issues/config.yaml: ${reason}`,
      { cause: err },
    );
  }
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
 * Find an issue file by its numeric ID prefix, in `.issues/` or
 * `.issues/closed/`. Throws `duplicate_issue` (listing the files) if more
 * than one file has the ID, rather than silently picking one.
 */
export async function findIssueFile(
  dir: string,
  id: number,
): Promise<{ filename: string; closed: boolean } | null> {
  const [openFiles, closedFiles] = await Promise.all([
    listIssueFiles(dir),
    listClosedIssueFiles(dir),
  ]);
  const matches = [
    ...openFiles
      .filter((f) => parseIssueId(f) === id)
      .map((filename) => ({ filename, closed: false })),
    ...closedFiles
      .filter((f) => parseIssueId(f) === id)
      .map((filename) => ({ filename, closed: true })),
  ];
  if (matches.length > 1) {
    throw duplicateIssue(
      id,
      matches.map((m) => issueRelPath(m.filename, m.closed)),
    );
  }
  return matches[0] ?? null;
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
    throw issueNotFound(id);
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
 * Rewrite an issue that was read from `from`, into `.issues/closed/`
 * (`to.closed`) or `.issues/`, under the filename its title gives. If that is
 * a different path — a different directory, or a filename that no longer
 * matches the title — the old file is renamed onto the new path (after
 * writing the new contents into it), so the issue is exactly one file at
 * every moment and readers never see a duplicate. Every service write of an
 * existing issue goes through here.
 * Returns the repo-relative paths involved (new path first, then the old one
 * if it differed) for the commit.
 */
export async function relocateIssue(
  dir: string,
  issue: Issue,
  from: { filename: string; closed: boolean },
  to: { closed: boolean },
): Promise<string[]> {
  const filename = issueFilename(issue.id, issue.title);
  const newPath = issueRelPath(filename, to.closed);
  const oldPath = issueRelPath(from.filename, from.closed);
  if (oldPath === newPath) {
    await writeIssue(dir, issue, { closed: to.closed });
    return [newPath];
  }
  await writeFile(join(dir, oldPath), serializeIssue(issue));
  await rename(join(dir, oldPath), join(dir, newPath));
  return [newPath, oldPath];
}

/**
 * Move an issue to .issues/closed/.
 */
export async function moveToClose(dir: string, id: number): Promise<void> {
  const found = await findIssueFile(dir, id);
  if (!found) {
    throw issueNotFound(id);
  }
  if (found.closed) {
    throw new GitracError('invalid_state', `Issue #${id} is already closed`, {
      details: { id },
    });
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
  if (!found) {
    throw issueNotFound(id);
  }
  if (!found.closed) {
    throw new GitracError('invalid_state', `Issue #${id} is not closed`, {
      details: { id },
    });
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
    throw new GitracError(
      'already_initialized',
      '.issues directory already exists (use --force to overwrite)',
    );
  }
  await mkdir(issDir, { recursive: true });
  await mkdir(closedDir(dir), { recursive: true });
  const config = createDefaultConfig();
  await writeConfig(dir, config);
}
