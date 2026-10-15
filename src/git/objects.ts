/**
 * Low-level helpers for reading many git objects with a constant number of
 * git processes (`cat-file --batch-check` / `--batch`), shared by the ID
 * allocator (`ids.ts`) and the cross-branch issue scan (`elsewhere.ts`).
 */

/** Run git with `input` on stdin; resolves to raw stdout (null on failure). */
export async function gitBytes(
  dir: string,
  args: string[],
  input?: string,
): Promise<Uint8Array | null> {
  try {
    const proc = Bun.spawn(['git', ...args], {
      cwd: dir,
      stdin: input === undefined ? 'ignore' : new TextEncoder().encode(input),
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const [out, code] = await Promise.all([
      // (`.bytes()` sometimes yields an ArrayBuffer in Bun 1.3; normalize.)
      new Response(proc.stdout).arrayBuffer(),
      proc.exited,
    ]);
    return code === 0 ? new Uint8Array(out) : null;
  } catch {
    return null;
  }
}

/** Like {@link gitBytes}, decoded as UTF-8. */
export async function gitText(
  dir: string,
  args: string[],
  input?: string,
): Promise<string | null> {
  const out = await gitBytes(dir, args, input);
  return out ? new TextDecoder().decode(out) : null;
}

/** An object name and type, as printed by `cat-file --batch-check`. */
export interface ObjectInfo {
  oid: string;
  type: string;
}

/**
 * Resolve object specs (e.g. `<rev>:./.issues`) with one
 * `git cat-file --batch-check`. Returns one entry per spec, in order (null
 * if it doesn't exist), or null if git failed.
 */
export async function resolveObjects(
  dir: string,
  specs: readonly string[],
): Promise<(ObjectInfo | null)[] | null> {
  if (specs.length === 0) return [];
  const out = await gitText(
    dir,
    ['cat-file', '--batch-check'],
    `${specs.join('\n')}\n`,
  );
  if (out === null) return null;
  const lines = out.split('\n');
  return specs.map((_, i) => {
    const [oid, type, size] = (lines[i] ?? '').split(' ');
    // Missing objects print "<spec> missing" (two fields).
    return oid && type && size !== undefined ? { oid, type } : null;
  });
}

/** An object read by {@link readObjects}. */
export interface GitObject {
  oid: string;
  type: string;
  content: Uint8Array;
}

/**
 * Read objects by name with one `git cat-file --batch`. Missing objects are
 * left out; resolves to an empty map if git failed.
 */
export async function readObjects(
  dir: string,
  oids: Iterable<string>,
): Promise<Map<string, GitObject>> {
  const objects = new Map<string, GitObject>();
  const list = [...new Set(oids)];
  if (list.length === 0) return objects;
  const out = await gitBytes(
    dir,
    ['cat-file', '--batch'],
    `${list.join('\n')}\n`,
  );
  if (!out) return objects;
  const decoder = new TextDecoder();
  let pos = 0;
  while (pos < out.length) {
    const eol = out.indexOf(0x0a, pos);
    if (eol < 0) break;
    const [oid = '', type, size] = decoder
      .decode(out.subarray(pos, eol))
      .split(' ');
    pos = eol + 1;
    if (type === undefined || size === undefined) continue; // "<x> missing"
    const end = pos + Number(size);
    objects.set(oid, { oid, type, content: out.subarray(pos, end) });
    pos = end + 1; // content is followed by a newline
  }
  return objects;
}

/** An entry of a tree object. */
export interface TreeEntry {
  /** e.g. `100644` (file), `40000` (tree). */
  mode: string;
  name: string;
  /** Hex object name. */
  oid: string;
}

/**
 * Parse a tree object's content: binary `<mode> <name>\0<raw oid>` per
 * entry. The raw oid is half as long as the tree's hex oid, so SHA-1 and
 * SHA-256 repositories both work.
 */
export function treeEntries(tree: GitObject): TreeEntry[] {
  if (tree.type !== 'tree') return [];
  const { content } = tree;
  const rawOidLength = tree.oid.length / 2;
  const decoder = new TextDecoder();
  const entries: TreeEntry[] = [];
  let p = 0;
  while (p < content.length) {
    const space = content.indexOf(0x20, p);
    const nul = content.indexOf(0x00, space);
    if (space < 0 || nul < 0) break;
    const raw = content.subarray(nul + 1, nul + 1 + rawOidLength);
    entries.push({
      mode: decoder.decode(content.subarray(p, space)),
      name: decoder.decode(content.subarray(space + 1, nul)),
      oid: Buffer.from(raw).toString('hex'),
    });
    p = nul + 1 + rawOidLength;
  }
  return entries;
}
