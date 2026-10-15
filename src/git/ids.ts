import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseIssueId } from '../core/slug.ts';
import { listAllIssueFiles, readConfig } from '../fs/issue-store.ts';
import { gitCommonDir } from './lock.ts';
import {
  gitText,
  readObjects,
  resolveObjects,
  treeEntries,
} from './objects.ts';

/**
 * Path, relative to the git common dir, of the shared ID high-water mark.
 * The file holds the next ID to hand out; every worktree of the repository
 * reads and bumps the same file (under the repo lock).
 */
export const NEXT_ID_FILE = join('gitrac', 'next-id');

/** Highest issue ID among `.md` filenames (0 if none). */
function maxIdOf(filenames: Iterable<string>): number {
  let max = 0;
  for (const f of filenames) {
    if (!f.endsWith('.md')) continue;
    const id = parseIssueId(f);
    if (id !== null && id > max) max = id;
  }
  return max;
}

/**
 * Highest issue ID in `.issues/*.md` / `.issues/closed/*.md` across every ref
 * of the repository (local branches, remote-tracking branches, tags, ...) and
 * `HEAD`, i.e. issues created on branches that aren't checked out here.
 *
 * Uses three git processes regardless of the number of refs: `for-each-ref`,
 * one `cat-file --batch-check` to resolve the `.issues` trees of every ref
 * (deduplicated, since most refs share them), and one `cat-file --batch` to
 * read those trees. Best effort: returns 0 outside a git repo or on error.
 */
export async function maxIssueIdInRefs(dir: string): Promise<number> {
  const refs = await gitText(dir, ['for-each-ref', '--format=%(objectname)']);
  if (refs === null) return 0;
  const revs = new Set(refs.split('\n').filter(Boolean));
  revs.add('HEAD');

  // `./` makes the path relative to `dir` rather than the repo root.
  const resolved = await resolveObjects(
    dir,
    [...revs].flatMap((rev) => [`${rev}:./.issues`, `${rev}:./.issues/closed`]),
  );
  if (!resolved) return 0;
  const trees = resolved.flatMap((o) => (o?.type === 'tree' ? [o.oid] : []));
  const objects = await readObjects(dir, trees);
  return maxIdOf(
    [...objects.values()].flatMap((tree) =>
      treeEntries(tree).map((e) => e.name),
    ),
  );
}

/** Path of the shared high-water mark file, or null outside a git repo. */
export async function nextIdPath(dir: string): Promise<string | null> {
  const commonDir = await gitCommonDir(resolve(dir));
  return commonDir ? join(commonDir, NEXT_ID_FILE) : null;
}

async function readHighWater(path: string | null): Promise<number> {
  if (!path) return 0;
  try {
    const value = Number.parseInt((await readFile(path, 'utf-8')).trim(), 10);
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

async function writeHighWater(path: string, next: number): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${next}\n`);
  await rename(tmp, path);
}

/**
 * Allocate the next issue ID. IDs are sequential integers; the new ID is one
 * past the highest of:
 *
 * - the shared high-water mark in `$(git rev-parse --git-common-dir)/gitrac/next-id`
 *   (shared by all worktrees of the repository; stores the next free ID),
 * - the issue files in this working tree (`.issues/` and `.issues/closed/`),
 * - the issue files on every ref, including remote-tracking branches
 *   (`maxIssueIdInRefs`),
 * - the legacy `nextId` counter in `config.yaml`, if present (read only).
 *
 * The high-water mark is then bumped. `config.yaml` is not written, so
 * parallel branches no longer conflict on it. Work in other clones that
 * hasn't been fetched can still produce the same ID.
 *
 * Callers must hold the repo lock (`withRepoLock`) across allocation, writing
 * the issue file and committing.
 */
export async function allocateIssueId(dir: string): Promise<number> {
  const path = await nextIdPath(dir);
  const [config, files, inRefs, highWater] = await Promise.all([
    readConfig(dir),
    listAllIssueFiles(dir),
    maxIssueIdInRefs(dir),
    readHighWater(path),
  ]);
  const id = Math.max(
    highWater,
    maxIdOf(files) + 1,
    inRefs + 1,
    config.nextId ?? 1,
  );
  if (path) await writeHighWater(path, id + 1);
  return id;
}
