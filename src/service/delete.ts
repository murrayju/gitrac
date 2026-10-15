import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { extractAssetRefs, isAssetFilename } from '../core/assets.ts';
import type { Config, Issue } from '../core/types.ts';
import { listClosedIssueFiles, listIssueFiles } from '../fs/issue-store.ts';
import { withRepoLock } from '../git/lock.ts';
import {
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

/** The result of {@link deleteIssue} (or what it would do, for a dry run). */
export interface IssueDeletion {
  /** The issue as it was before deletion. */
  issue: Issue;
  /**
   * Repo-relative paths removed (or that would be): the issue file first,
   * then {@link assets}. This is what was, or would be, committed.
   */
  paths: string[];
  /** The `.issues/assets/` files only this issue referenced (a subset of `paths`). */
  assets: string[];
  config: Config;
  /** The new commit's hash, or null if nothing was committed (or dry run). */
  commit: string | null;
}

export interface DeleteIssueOptions {
  /** Checked on the loaded issue before anything else (e.g. `If-Match`). */
  precondition?: Precondition;
  /** Report what would be deleted without touching disk or committing. */
  dryRun?: boolean;
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

/**
 * Delete an issue: remove its file (from `.issues/` or `.issues/closed/`)
 * plus any `.issues/assets/` files that only it referenced, and commit the
 * removal (`issue: delete #N <title>`) per the context's commit options. With
 * `dryRun`, only reports what would be removed. The issue ID is not reused:
 * the shared high-water mark already counted it.
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
    const result = { issue, paths, assets, config, commit: null };
    if (options.dryRun) return result;

    for (const path of assets) {
      await rm(join(ctx.dir, path), { force: true });
    }
    await rm(join(ctx.dir, file), { force: true });

    const commit = await commitChange(ctx, config, {
      operation: 'delete',
      issue,
      paths,
      message: commitMessage(config, `delete #${id} ${issue.title}`),
    });
    return { ...result, commit };
  });
}
