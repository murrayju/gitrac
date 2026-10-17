import { ensureLabelColors } from '../core/config.ts';
import { invalidInput } from '../core/errors.ts';
import type { Assignee, Config } from '../core/types.ts';
import { assigneeErrors } from '../core/validate.ts';
import {
  ISSUES_GITIGNORE_PATH,
  writeIssuesGitignore,
} from '../fs/gitignore.ts';
import { initIssuesDir, readConfig, writeConfig } from '../fs/issue-store.ts';
import { withRepoLock } from '../git/lock.ts';
import { detectDefaultBranch } from '../git/status.ts';
import {
  CONFIG_PATH,
  commitChange,
  commitMessage,
  loadConfig,
  type ServiceContext,
} from './context.ts';
import { setUpMergeDriver } from './merge-driver.ts';

/** The result of a config change. */
export interface ConfigChange {
  /** The config as written. */
  config: Config;
  /** Repo-relative paths written (what was, or would be, committed). */
  paths: string[];
  /** The new commit's hash, or null if nothing was committed. */
  commit: string | null;
}

/**
 * Create `.issues/` with a default config (`git.defaultBranch` detected from
 * the repo: `origin/HEAD`, else the current branch, else
 * `init.defaultBranch`, else `main`; `force` overwrites an existing
 * one; otherwise that is `already_initialized`) and `.issues/.gitignore`
 * (web UI drafts), install the git merge driver (`.issues/.gitattributes` +
 * local git config; `mergeDriverCommand` overrides the command it runs) and
 * commit.
 */
export async function initProject(
  ctx: ServiceContext,
  options: { force?: boolean; mergeDriverCommand?: string } = {},
): Promise<ConfigChange> {
  return withRepoLock(ctx.dir, async () => {
    const defaultBranch = await detectDefaultBranch(ctx.dir);
    await initIssuesDir(ctx.dir, { force: options.force, defaultBranch });
    const ignored = await writeIssuesGitignore(ctx.dir);
    const driver = await setUpMergeDriver(ctx.dir, options.mergeDriverCommand);
    const paths = [
      CONFIG_PATH,
      ...(ignored ? [ISSUES_GITIGNORE_PATH] : []),
      ...driver.paths,
    ];
    // Freshly created, so read it back for the commit settings.
    const config = await loadConfig(ctx);
    const commit = await commitChange(ctx, config, {
      operation: 'init',
      issue: null,
      paths,
      message: commitMessage(config, 'initialize issue tracker'),
    });
    return { config, paths, commit };
  });
}

/**
 * Merge `labels` (name -> color) into the configured label colors; any label
 * left without a color gets one. `labels` must be an object.
 */
export async function updateLabelColors(
  ctx: ServiceContext,
  labels: unknown,
): Promise<ConfigChange> {
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    if (
      typeof labels !== 'object' ||
      labels === null ||
      Array.isArray(labels)
    ) {
      throw invalidInput('labels must be an object');
    }

    // Merge into what is on disk now
    const fresh = await readConfig(ctx.dir);
    fresh.labels = { ...fresh.labels, ...(labels as Record<string, string>) };
    // Ensure all labels still have colors
    fresh.labels = ensureLabelColors(Object.keys(fresh.labels), fresh.labels);
    await writeConfig(ctx.dir, fresh);

    const paths = [CONFIG_PATH];
    const commit = await commitChange(ctx, config, {
      operation: 'label-colors',
      issue: null,
      paths,
      message: commitMessage(config, 'update label colors'),
    });
    return { config: fresh, paths, commit };
  });
}

/**
 * Replace the configured assignees. `assignees` must be an array of objects
 * with non-empty `name` and `email` strings. A name or email must not
 * contain a line break or the em dash (`assigneeErrors`): the name can become
 * a comment author and the email an assignee. Throws `invalid_input` with
 * every bad entry before anything is written.
 */
export async function updateAssignees(
  ctx: ServiceContext,
  assignees: unknown,
): Promise<ConfigChange> {
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    if (!Array.isArray(assignees)) {
      throw invalidInput('assignees must be an array');
    }
    const errors = assignees.flatMap((a) => assigneeErrors(a));
    if (errors.length > 0) throw invalidInput(errors);

    const fresh = await readConfig(ctx.dir);
    fresh.assignees = assignees as Assignee[];
    await writeConfig(ctx.dir, fresh);

    const paths = [CONFIG_PATH];
    const commit = await commitChange(ctx, config, {
      operation: 'assignees',
      issue: null,
      paths,
      message: commitMessage(config, 'update assignees'),
    });
    return { config: fresh, paths, commit };
  });
}
