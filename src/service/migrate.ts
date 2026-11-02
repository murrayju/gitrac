import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_VERSION } from '../core/config.ts';
import { migrateLegacyLinks } from '../core/issue.ts';
import { atomicWriteFile } from '../fs/atomic-write.ts';
import {
  listClosedIssueFiles,
  listIssueFiles,
  writeConfig,
} from '../fs/issue-store.ts';
import { operationInProgress } from '../git/branches.ts';
import { withRepoLock } from '../git/lock.ts';
import {
  CONFIG_PATH,
  commitChange,
  commitMessage,
  issuePath,
  loadConfig,
  type ServiceContext,
} from './context.ts';

/** The result of {@link migrateProject}. */
export interface Migration {
  /** The config version before. */
  from: number;
  /** The config version now ({@link CONFIG_VERSION}). */
  to: number;
  /** Repo-relative paths written: the rewritten issue files, then the config. */
  paths: string[];
  /** The new commit's hash, or null if nothing was committed. */
  commit: string | null;
}

/**
 * Bring an older `.issues/` up to {@link CONFIG_VERSION}, once: if the
 * config `version` is older, rewrite every issue file (open and closed) that
 * has fields of an older version, set the config `version`, and commit it
 * all (`issue: migrate .issues to version N`) per the context's commit
 * options. Nothing else in the files changes (`updated` included), so it is
 * not an edit. A file that can't be parsed is left as it is.
 *
 * Returns null, and writes nothing, if the config is not older, or while a
 * git operation (merge, rebase, ...) is in progress: committing then would
 * mix the migration into it; the next command migrates instead. Version 2:
 * `parent` / `blockedBy` / `duplicateOf` become `links` (gitrac still reads
 * them, e.g. in a file merged in from an older branch, and writes `links`).
 */
export async function migrateProject(
  ctx: ServiceContext,
): Promise<Migration | null> {
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const from = config.version;
    if (from >= CONFIG_VERSION) return null;
    if (await operationInProgress(ctx.dir)) return null;

    const paths: string[] = [];
    for (const [closed, files] of [
      [false, await listIssueFiles(ctx.dir)],
      [true, await listClosedIssueFiles(ctx.dir)],
    ] as const) {
      for (const filename of files) {
        const path = issuePath(filename, closed);
        let migrated: string | null;
        try {
          migrated = migrateLegacyLinks(
            await readFile(join(ctx.dir, path), 'utf-8'),
          );
        } catch {
          // Malformed: commands report it when they read it.
          continue;
        }
        if (migrated === null) continue;
        await atomicWriteFile(join(ctx.dir, path), migrated);
        paths.push(path);
      }
    }
    config.version = CONFIG_VERSION;
    await writeConfig(ctx.dir, config);
    paths.push(CONFIG_PATH);
    const commit = await commitChange(ctx, config, {
      operation: 'migrate',
      issue: null,
      paths,
      message: commitMessage(
        config,
        `migrate .issues to version ${CONFIG_VERSION}`,
      ),
    });
    return { from, to: CONFIG_VERSION, paths, commit };
  });
}
