import { readdir, readFile, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { IssueStateElsewhere } from '../core/elsewhere.ts';
import { parseIssueFile } from '../core/issue.ts';
import { parseIssueId } from '../core/slug.ts';
import {
  gitText,
  readObjects,
  resolveObjects,
  treeEntries,
} from './objects.ts';

/**
 * Gather the versions of issues on other branches and in other worktrees, so
 * a claim made in one worktree (committed or not) is visible in all of them
 * (see `src/core/elsewhere.ts` for how they're used).
 */

/** A worktree from `git worktree list --porcelain`. */
interface Worktree {
  path: string;
  /** Short branch name, or `HEAD` if detached. */
  ref: string;
}

function shortRef(refname: string): string {
  return refname.replace(/^refs\/(heads|remotes)\//, '');
}

function parseWorktrees(out: string): Worktree[] {
  const worktrees: Worktree[] = [];
  for (const block of out.split('\n\n')) {
    const lines = block.split('\n');
    const path = lines
      .find((l) => l.startsWith('worktree '))
      ?.slice('worktree '.length);
    // Bare repositories have no working tree to read.
    if (!path || lines.includes('bare')) continue;
    const branch = lines
      .find((l) => l.startsWith('branch '))
      ?.slice('branch '.length);
    worktrees.push({ path, ref: branch ? shortRef(branch) : 'HEAD' });
  }
  return worktrees;
}

async function realpathOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/** Parse an issue file's content into a state; null if malformed. */
function toState(
  content: string,
  id: number,
  path: string,
  where: Pick<IssueStateElsewhere, 'ref' | 'worktree'>,
): IssueStateElsewhere | null {
  try {
    const issue = parseIssueFile(content, { id, path });
    return {
      ...where,
      status: issue.status,
      assignee: issue.assignee,
      updated: issue.updated,
    };
  } catch {
    return null;
  }
}

function wanted(id: number | null, ids?: ReadonlySet<number>): id is number {
  return id !== null && (ids === undefined || ids.has(id));
}

/** Read the issue files in another worktree's working tree (best effort). */
async function worktreeStates(
  root: string,
  worktree: Worktree,
  ids?: ReadonlySet<number>,
): Promise<{ id: number; state: IssueStateElsewhere }[]> {
  const found: { id: number; state: IssueStateElsewhere }[] = [];
  for (const sub of ['', 'closed']) {
    const dir = join(root, '.issues', sub);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    await Promise.all(
      files.map(async (file) => {
        const id = parseIssueId(file);
        if (!file.endsWith('.md') || !wanted(id, ids)) return;
        try {
          const content = await readFile(join(dir, file), 'utf-8');
          const state = toState(content, id, join('.issues', sub, file), {
            ref: worktree.ref,
            worktree: worktree.path,
          });
          if (state) found.push({ id, state });
        } catch {
          // Unreadable (e.g. removed meanwhile): skip.
        }
      }),
    );
  }
  return found;
}

/**
 * The versions of issues (all, or just `ids`) that differ from this
 * worktree's: in every other worktree's working tree (including uncommitted
 * claims), then on every local and remote-tracking branch other than the one
 * checked out here. Grouped by issue ID; within an ID, worktrees come first,
 * then local branches, then remote-tracking ones (so equal timestamps
 * resolve to the most specific location).
 *
 * A branch's version is skipped when it is the same blob as in this
 * worktree's `HEAD` (it's already here). Uses five git processes regardless
 * of the number of refs (`for-each-ref`, `worktree list`, one
 * `cat-file --batch-check` and two `cat-file --batch`), plus plain file reads
 * of the other worktrees. Best effort: an empty map outside a git repo or on
 * error.
 */
export async function issueStatesElsewhere(
  dir: string,
  options: { ids?: Iterable<number> } = {},
): Promise<Map<number, IssueStateElsewhere[]>> {
  const ids = options.ids === undefined ? undefined : new Set(options.ids);
  const result = new Map<number, IssueStateElsewhere[]>();
  if (ids?.size === 0) return result;
  const add = (id: number, state: IssueStateElsewhere) => {
    const list = result.get(id);
    if (list) list.push(state);
    else result.set(id, [state]);
  };

  const [refsOut, worktreesOut, here] = await Promise.all([
    gitText(dir, [
      'for-each-ref',
      '--format=%(HEAD)%00%(objectname)%00%(refname)',
      'refs/heads',
      'refs/remotes',
    ]),
    gitText(dir, ['worktree', 'list', '--porcelain']),
    realpathOrSelf(dir),
  ]);
  if (refsOut === null) return result;

  // Other worktrees' working trees. `dir` may be below the worktree root:
  // find ours (the longest containing path) and use the same subdirectory.
  const worktrees = await Promise.all(
    parseWorktrees(worktreesOut ?? '').map(async (w) => ({
      ...w,
      real: await realpathOrSelf(w.path),
    })),
  );
  const contains = (root: string) =>
    here === root || here.startsWith(root.endsWith(sep) ? root : root + sep);
  const current = worktrees
    .filter((w) => contains(w.real))
    .sort((a, b) => b.real.length - a.real.length)[0];
  const prefix = current ? relative(current.real, here) : '';
  const others = worktrees.filter((w) => w !== current);
  const fromWorktrees = await Promise.all(
    others.map((w) => worktreeStates(join(w.path, prefix), w, ids)),
  );
  for (const found of fromWorktrees) {
    for (const { id, state } of found) add(id, state);
  }

  // Branches: one name per commit (local branches sort before remote ones);
  // skip the branch checked out here and `origin/HEAD`-style aliases.
  const refByCommit = new Map<string, string>();
  for (const line of refsOut.split('\n')) {
    const [head, oid, refname] = line.split('\0');
    if (!oid || !refname || head === '*') continue;
    if (refname.startsWith('refs/remotes/') && refname.endsWith('/HEAD')) {
      continue;
    }
    if (!refByCommit.has(oid)) refByCommit.set(oid, shortRef(refname));
  }
  const revs = ['HEAD', ...refByCommit.keys()];
  // `./` makes the path relative to `dir` rather than the repo root.
  const resolved = await resolveObjects(
    dir,
    revs.flatMap((rev) => [`${rev}:./.issues`, `${rev}:./.issues/closed`]),
  );
  if (!resolved) return result;
  const trees = await readObjects(
    dir,
    resolved.flatMap((o) => (o?.type === 'tree' ? [o.oid] : [])),
  );
  /** The issue blobs of a rev's `.issues` and `.issues/closed` trees. */
  const blobsOf = (index: number) =>
    [0, 1].flatMap((k) => {
      const tree = resolved[index * 2 + k];
      const object = tree ? trees.get(tree.oid) : undefined;
      if (!object) return [];
      return treeEntries(object).flatMap((e) => {
        const id = parseIssueId(e.name);
        return e.mode.startsWith('100') &&
          e.name.endsWith('.md') &&
          wanted(id, ids)
          ? [
              {
                id,
                oid: e.oid,
                path: join('.issues', k ? 'closed' : '', e.name),
              },
            ]
          : [];
      });
    });

  const atHead = new Set(blobsOf(0).map((b) => b.oid));
  // Each differing blob once, attributed to the first ref that has it.
  const blobs = new Map<string, { id: number; path: string; ref: string }>();
  [...refByCommit.values()].forEach((ref, i) => {
    for (const blob of blobsOf(i + 1)) {
      if (!atHead.has(blob.oid) && !blobs.has(blob.oid)) {
        blobs.set(blob.oid, { id: blob.id, path: blob.path, ref });
      }
    }
  });
  const contents = await readObjects(dir, blobs.keys());
  const decoder = new TextDecoder();
  for (const [oid, { id, path, ref }] of blobs) {
    const object = contents.get(oid);
    if (!object) continue;
    const state = toState(decoder.decode(object.content), id, path, { ref });
    if (state) add(id, state);
  }
  return result;
}
