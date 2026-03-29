import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createDefaultConfig,
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
 * Read and parse an issue by its numeric ID.
 */
export async function readIssue(dir: string, id: number): Promise<Issue> {
  const found = await findIssueFile(dir, id);
  if (!found) {
    throw new Error(`Issue #${id} not found`);
  }
  const base = found.closed ? closedDir(dir) : issuesDir(dir);
  const content = await readFile(join(base, found.filename), 'utf-8');
  return parseIssue(content);
}

/**
 * Write an issue to .issues/ using the correct filename.
 * Returns the filename.
 */
export async function writeIssue(dir: string, issue: Issue): Promise<string> {
  const filename = issueFilename(issue.id, issue.title);
  const content = serializeIssue(issue);
  await writeFile(join(issuesDir(dir), filename), content);
  return filename;
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
  if (!found || !found.closed) {
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
 * Allocate the next issue ID: reads config, returns current nextId,
 * increments and writes back.
 */
export async function allocateNextId(dir: string): Promise<number> {
  const config = await readConfig(dir);
  const id = config.nextId;
  config.nextId = id + 1;
  await writeConfig(dir, config);
  return id;
}
