import { resolve } from 'node:path';

/**
 * Read all of stdin as UTF-8 text. When `onlyIfPiped` is set and stdin is a
 * TTY, returns '' instead of blocking for interactive input (used by the
 * implicit stdin fallback of `comment`). An explicit `-` always reads.
 */
export async function readStdin(
  options: { onlyIfPiped?: boolean } = {},
): Promise<string> {
  if (options.onlyIfPiped && process.stdin.isTTY) {
    return '';
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Read text from a file path, or from stdin when `path` is `-`. Relative paths
 * are resolved against the current working directory (not `--dir`).
 * Throws an Error with a user-facing message if the file can't be read.
 */
export async function readTextSource(
  path: string,
  flag: string,
): Promise<string> {
  if (path === '-') return readStdin();
  const abs = resolve(process.cwd(), path);
  const file = Bun.file(abs);
  if (!(await file.exists())) {
    throw new Error(`${flag}: file not found: ${path}`);
  }
  try {
    return await file.text();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${flag}: cannot read ${path}: ${reason}`);
  }
}

/**
 * Resolve a text value that may be given inline (e.g. `--description <text>`)
 * or via a file option (e.g. `--description-file <path|->`). Returns
 * `undefined` when neither was given. Giving both is an error. The result is
 * trimmed, matching how descriptions and comment bodies round-trip through
 * the issue file.
 */
export async function resolveTextOption(opts: {
  inline: string | undefined;
  file: string | undefined;
  inlineFlag: string;
  fileFlag: string;
}): Promise<string | undefined> {
  const { inline, file, inlineFlag, fileFlag } = opts;
  if (inline !== undefined && file !== undefined) {
    throw new Error(`Use either ${inlineFlag} or ${fileFlag}, not both.`);
  }
  if (file !== undefined) {
    return (await readTextSource(file, fileFlag)).trim();
  }
  if (inline !== undefined) return inline.trim();
  return undefined;
}

/**
 * {@link resolveTextOption}, but prints the error and exits 1 on failure.
 * Call this outside `withMutationLock` (it may block reading stdin).
 */
export async function resolveTextOptionOrExit(
  opts: Parameters<typeof resolveTextOption>[0],
): Promise<string | undefined> {
  try {
    return await resolveTextOption(opts);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
