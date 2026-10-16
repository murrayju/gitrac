import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { extractAssetRefs, isAssetFilename } from '../core/assets.ts';
import { blockersOf } from '../core/dependencies.ts';
import { nextTimestamp } from '../core/timestamp.ts';
import type { Config, Issue } from '../core/types.ts';
import { isClosedStatus, type StatusConfig } from '../core/workflow.ts';
import {
  listClosedIssueFiles,
  listIssueFiles,
  relocateIssue,
} from '../fs/issue-store.ts';
import { withRepoLock } from '../git/lock.ts';
import {
  assetPaths,
  commitChange,
  commitMessage,
  issuePath,
  loadConfig,
  type ServiceContext,
} from './context.ts';
import {
  loadStoredIssue,
  type Precondition,
  type StoredIssue,
} from './load.ts';
import { linkingIssues, rewritePaths } from './references.ts';

/**
 * Another issue whose links to the deleted issue are removed (or would be)
 * by {@link deleteIssue}.
 */
export interface UnlinkedIssue {
  id: number;
  title: string;
  /** The deleted issue is removed from its `blockedBy`. */
  blockedBy: boolean;
  /** Its `parent` (the deleted issue) is cleared. */
  parent: boolean;
  /**
   * Repo-relative paths of its rewritten file: the path it is written to,
   * then the old one if its filename was stale (see `relocateIssue`).
   */
  paths: string[];
}

/** The result of {@link deleteIssue} (or what it would do, for a dry run). */
export interface IssueDeletion {
  /** The issue as it was before deletion. */
  issue: Issue;
  /**
   * Repo-relative paths removed (or that would be): the issue file first,
   * then {@link assets}. The commit also includes the {@link unlinked}
   * issues' files (and the assets they reference).
   */
  paths: string[];
  /** The `.issues/assets/` files only this issue referenced (a subset of `paths`). */
  assets: string[];
  /**
   * Other issues (open or closed) that referenced the deleted one in
   * `blockedBy` or `parent`, by ID; those links are removed in the same
   * commit so none dangles.
   */
  unlinked: UnlinkedIssue[];
  config: Config;
  /** The new commit's hash, or null if nothing was committed (or dry run). */
  commit: string | null;
}

export interface DeleteIssueOptions {
  /** Checked on the loaded issue before anything else (e.g. `If-Match`). */
  precondition?: Precondition;
  /** Report what would be deleted without touching disk or committing. */
  dryRun?: boolean;
  /**
   * Called once the files are removed/rewritten, before committing (with
   * `commit: null`), so a caller can report the deletion even if the commit
   * then fails. Not called for a dry run.
   */
  onDeleted?: (deletion: IssueDeletion) => void;
}

/** Repo-relative path of an asset file. */
function assetPath(name: string): string {
  return join('.issues', 'assets', name);
}

/** Whether a file exists (as anything) at `path`. */
async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

/**
 * Raw contents of every issue file except `skip` (open and closed) and of
 * every web UI draft — everything that can reference an asset. Returns null
 * if any of them can't be read, so callers can err on the side of keeping
 * assets.
 */
async function otherContents(
  dir: string,
  skip: string,
): Promise<string[] | null> {
  try {
    const [open, closed] = await Promise.all([
      listIssueFiles(dir),
      listClosedIssueFiles(dir),
    ]);
    const paths = [
      ...open.map((f) => issuePath(f, false)),
      ...closed.map((f) => issuePath(f, true)),
    ].filter((p) => p !== skip);
    const draftsDir = join('.issues', 'drafts');
    const drafts = await readdir(join(dir, draftsDir)).catch(() => []);
    paths.push(
      ...drafts
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(draftsDir, f)),
    );
    return await Promise.all(paths.map((p) => readFile(join(dir, p), 'utf-8')));
  } catch {
    return null;
  }
}

/**
 * Assets referenced by `stored` that exist in `.issues/assets/` and that no
 * other issue (open or closed) or draft mentions. Matching is deliberately
 * loose — any occurrence of the filename elsewhere keeps the asset — so a
 * shared image is never removed.
 */
async function orphanedAssets(
  dir: string,
  stored: StoredIssue,
): Promise<string[]> {
  const candidates = extractAssetRefs(stored.content).filter(isAssetFilename);
  if (candidates.length === 0) return [];
  const others = await otherContents(
    dir,
    issuePath(stored.filename, stored.closed),
  );
  if (others === null) return [];
  const orphans: string[] = [];
  for (const name of candidates) {
    if (others.some((content) => content.includes(name))) continue;
    if (!(await exists(join(dir, assetPath(name))))) continue;
    orphans.push(name);
  }
  return orphans.sort();
}

/** An issue that links to the deleted one, as loaded, with the fix applied. */
interface Relink {
  stored: StoredIssue;
  unlinked: UnlinkedIssue;
}

/**
 * Every other issue (open or closed) whose `blockedBy` or `parent` points at
 * `id`, loaded fresh (callers hold the lock) with those links removed in
 * memory (see {@link linkingIssues}).
 */
async function referencingIssues(
  dir: string,
  id: number,
  config: StatusConfig,
): Promise<Relink[]> {
  const relinks: Relink[] = [];
  for (const { stored, blockedBy, parent } of await linkingIssues(dir, id)) {
    const { issue } = stored;
    if (blockedBy) {
      const kept = blockersOf(issue).filter((b) => b !== id);
      if (kept.length > 0) issue.blockedBy = kept;
      else delete issue.blockedBy;
    }
    if (parent) delete issue.parent;
    relinks.push({
      stored,
      unlinked: {
        id: issue.id,
        title: issue.title,
        blockedBy,
        parent,
        paths: rewritePaths(stored, config),
      },
    });
  }
  return relinks;
}

/**
 * Delete an issue: remove its file (from `.issues/` or `.issues/closed/`)
 * plus any `.issues/assets/` files that only it referenced, remove it from
 * every other issue's `blockedBy` and clear `parent` where it was the parent
 * (bumping their `updated`), and commit it all at once
 * (`issue: delete #N <title>`) per the context's commit options. With
 * `dryRun`, only reports what would be removed and unlinked. The issue ID is
 * not reused: the shared high-water mark already counted it.
 */
export async function deleteIssue(
  ctx: ServiceContext,
  id: number,
  options: DeleteIssueOptions = {},
): Promise<IssueDeletion> {
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const { issue } = stored;
    const file = issuePath(stored.filename, stored.closed);
    const assets = (await orphanedAssets(ctx.dir, stored)).map(assetPath);
    const paths = [file, ...assets];
    const relinks = await referencingIssues(ctx.dir, id, config);
    const unlinked = relinks.map((r) => r.unlinked);
    const result: IssueDeletion = {
      issue,
      paths,
      assets,
      unlinked,
      config,
      commit: null,
    };
    if (options.dryRun) return result;

    const committed = new Set(paths);
    const now = Date.now();
    for (const { stored, unlinked: entry } of relinks) {
      stored.issue.updated = nextTimestamp([stored.issue.updated], now);
      entry.paths = await relocateIssue(ctx.dir, stored.issue, stored, {
        closed: isClosedStatus(config, stored.issue.status),
      });
      for (const p of [...entry.paths, ...assetPaths(stored.issue)]) {
        committed.add(p);
      }
    }
    for (const path of assets) {
      await rm(join(ctx.dir, path), { force: true });
    }
    await rm(join(ctx.dir, file), { force: true });

    options.onDeleted?.(result);
    const commit = await commitChange(ctx, config, {
      operation: 'delete',
      issue,
      paths: [...committed],
      message: commitMessage(config, `delete #${id} ${issue.title}`),
    });
    return { ...result, commit };
  });
}
