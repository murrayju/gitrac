import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Save the working-tree file and the index entries of some paths, and put
 * them back later. `gitrac commit` uses this to undo its close when the
 * `git commit` fails, so the repo is the same as before.
 */

/** The saved state of one repo-relative path. */
export interface PathState {
  /** The working-tree file, or null if there was no file. */
  file: { content: Uint8Array; mode: number } | null;
  /**
   * The index entries of the path, as `git ls-files -s` prints them
   * (`<mode> <oid> <stage>\t<path>`; more than one while in conflict).
   * Empty if the path was not in the index.
   */
  index: string[];
}

/** Saved states by repo-relative path. */
export type PathSnapshot = Map<string, PathState>;

/** Run git in `dir`; resolves to stdout, or throws with git's stderr. */
async function git(
  dir: string,
  args: string[],
  input?: string,
): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd: dir,
    stdin: input === undefined ? 'ignore' : new TextEncoder().encode(input),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`git ${args[0]} failed: ${err.trim() || `exit ${code}`}`);
  }
  return out;
}

async function readWorkingFile(path: string): Promise<PathState['file']> {
  try {
    const [content, info] = await Promise.all([readFile(path), stat(path)]);
    return { content, mode: info.mode & 0o777 };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Save the working-tree file and index entries of each of `paths`. */
export async function snapshotPaths(
  dir: string,
  paths: readonly string[],
): Promise<PathSnapshot> {
  const unique = [...new Set(paths)];
  const snapshot: PathSnapshot = new Map();
  if (unique.length === 0) return snapshot;
  const listed = await git(dir, [
    'ls-files',
    '-s',
    '-z',
    '--',
    ...unique.map((p) => `:(literal)${p}`),
  ]);
  const entries = listed.split('\0').filter(Boolean);
  for (const path of unique) {
    snapshot.set(path, {
      file: await readWorkingFile(resolve(dir, path)),
      index: entries.filter((e) => e.slice(e.indexOf('\t') + 1) === path),
    });
  }
  return snapshot;
}

/**
 * Put the working-tree files and index entries of the paths in `snapshot`
 * back as they were. A path that had no file is removed from the working
 * tree; a path that was not in the index is removed from it.
 */
export async function restorePaths(
  dir: string,
  snapshot: PathSnapshot,
): Promise<void> {
  if (snapshot.size === 0) return;
  for (const [path, state] of snapshot) {
    const abs = resolve(dir, path);
    if (state.file) {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, state.file.content);
      await chmod(abs, state.file.mode);
    } else {
      await rm(abs, { force: true });
    }
  }
  const paths = [...snapshot.keys()];
  await git(
    dir,
    ['update-index', '--force-remove', '-z', '--stdin'],
    paths.map((p) => `${p}\0`).join(''),
  );
  const entries = [...snapshot.values()].flatMap((s) => s.index);
  if (entries.length > 0) {
    await git(
      dir,
      ['update-index', '-z', '--index-info'],
      entries.map((e) => `${e}\0`).join(''),
    );
  }
  // Refresh the stat data of the entries, so `git status` is quiet for
  // files that are the same as the index. Ignore "needs update" results.
  await git(dir, ['update-index', '-q', '--refresh']).catch(() => '');
}
