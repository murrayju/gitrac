import { resolve } from 'node:path';
import { invalidInput } from '../core/errors.ts';

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
 * Throws an `invalid_input` error if the file can't be read.
 */
export async function readTextSource(
  path: string,
  flag: string,
): Promise<string> {
  if (path === '-') return readStdin();
  const abs = resolve(process.cwd(), path);
  const file = Bun.file(abs);
  if (!(await file.exists())) {
    throw invalidInput(`${flag}: file not found: ${path}`);
  }
  try {
    return await file.text();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw invalidInput(`${flag}: cannot read ${path}: ${reason}`);
  }
}

/**
 * Resolve a text value that may be given inline (e.g. `--description <text>`)
 * or via a file option (e.g. `--description-file <path|->`). Returns
 * `undefined` when neither was given. Giving both is an error. The result is
 * trimmed, matching how descriptions and comment bodies round-trip through
 * the issue file. Throws `invalid_input` on bad input. Call this before the
 * service operation, which takes the repo lock (it may block reading stdin).
 */
export async function resolveTextOption(opts: {
  inline: string | undefined;
  file: string | undefined;
  inlineFlag: string;
  fileFlag: string;
}): Promise<string | undefined> {
  const { inline, file, inlineFlag, fileFlag } = opts;
  if (inline !== undefined && file !== undefined) {
    throw invalidInput(`Use either ${inlineFlag} or ${fileFlag}, not both.`);
  }
  if (file !== undefined) {
    return (await readTextSource(file, fileFlag)).trim();
  }
  if (inline !== undefined) return inline.trim();
  return undefined;
}
