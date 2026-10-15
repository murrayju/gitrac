import { randomUUID } from 'node:crypto';
import { open, realpath, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/** Suffix of {@link atomicWriteFile}'s temp files. */
export const ATOMIC_TEMP_SUFFIX = '.tmp';

/**
 * Name of a temp file for writing `path` atomically: a hidden sibling in the
 * same directory (so the final `rename` is atomic — same filesystem), unique
 * per call, ending in `.tmp`. It never ends in `.md` and is never
 * `config.yaml`, so issue listings, commits (explicit paths), and the merge
 * driver ignore it.
 */
export function atomicTempPath(path: string): string {
  return join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}${ATOMIC_TEMP_SUFFIX}`,
  );
}

/** Follow a symlink at `path` so the link itself isn't replaced by a file. */
async function resolveTarget(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path; // doesn't exist yet (or dangling): write `path` itself
  }
}

/**
 * Write `content` to `path` atomically: write and fsync a temp file in the
 * same directory, then `rename` it over `path`. Readers (and a crash) see
 * either the old file or the complete new one, never a partial write. An
 * existing file's permission bits are kept. On failure the temp file is
 * removed and `path` is untouched. The parent directory must exist.
 */
export async function atomicWriteFile(
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  const target = await resolveTarget(path);
  let mode: number | null = null;
  try {
    mode = (await stat(target)).mode & 0o7777;
  } catch {
    // new file: default mode (0o666 masked by the umask), like writeFile
  }
  const tmp = atomicTempPath(target);
  try {
    const handle = await open(tmp, 'wx', mode ?? 0o666);
    try {
      // `open`'s mode is masked by the umask; set the old mode exactly.
      if (mode !== null) await handle.chmod(mode);
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
