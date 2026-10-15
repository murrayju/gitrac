import {
  ISSUES_GITIGNORE_PATH,
  writeIssuesGitignore,
} from '../fs/gitignore.ts';
import { withRepoLock } from '../git/lock.ts';
import {
  configureMergeDriver,
  defaultMergeDriverCommand,
  GITATTRIBUTES_PATH,
  writeMergeAttributes,
} from '../git/merge-driver.ts';
import {
  commitChange,
  commitMessage,
  loadConfig,
  type ServiceContext,
} from './context.ts';

/** What installing the merge driver did. */
export interface MergeDriverInstall {
  /** The command `merge.gitrac.driver` runs (before its arguments). */
  command: string;
  /** True if the local git config was written (false outside a git repo). */
  configured: boolean;
  /**
   * Repo-relative paths written: `.issues/.gitattributes` and (from
   * {@link installMergeDriver}) `.issues/.gitignore`, each only if it changed.
   */
  paths: string[];
  /** The new commit's hash, or null if nothing was committed. */
  commit: string | null;
}

/**
 * Write `.issues/.gitattributes` and the local git config without locking or
 * committing (for {@link installMergeDriver} and `initProject`). Callers hold
 * the repo lock.
 */
export async function setUpMergeDriver(
  dir: string,
  command?: string,
): Promise<Omit<MergeDriverInstall, 'commit'>> {
  const cmd = command?.trim() || defaultMergeDriverCommand(dir);
  const changed = await writeMergeAttributes(dir);
  const configured = await configureMergeDriver(dir, cmd);
  return {
    command: cmd,
    configured,
    paths: changed ? [GITATTRIBUTES_PATH] : [],
  };
}

/**
 * Install gitrac's git merge driver: route `.issues/**\/*.md` and
 * `config.yaml` to it in `.issues/.gitattributes` (committed, if it changed)
 * and define `merge.gitrac.driver` in the local git config (not committed;
 * each clone runs this once — `gitrac init` does it too). Also ensures
 * `.issues/.gitignore` ignores web UI drafts (committed, if it changed), so
 * projects initialized before gitrac wrote that file get it too. Idempotent.
 */
export async function installMergeDriver(
  ctx: ServiceContext,
  options: { command?: string } = {},
): Promise<MergeDriverInstall> {
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const ignored = await writeIssuesGitignore(ctx.dir);
    const setUp = await setUpMergeDriver(ctx.dir, options.command);
    const paths = [...setUp.paths, ...(ignored ? [ISSUES_GITIGNORE_PATH] : [])];
    const commit =
      paths.length > 0
        ? await commitChange(ctx, config, {
            operation: 'merge-driver',
            issue: null,
            paths,
            message: commitMessage(config, 'install merge driver'),
          })
        : null;
    return { ...setUp, paths, commit };
  });
}
