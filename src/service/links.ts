import {
  blockersOf,
  indexIssues,
  type LinkChanges,
  parseLinkChanges,
  parseUnlinkChanges,
  type UnlinkChanges,
  validateLinks,
} from '../core/dependencies.ts';
import { dependencyFields, normalizeIdList } from '../core/issue.ts';
import type { Config, Issue } from '../core/types.ts';
import { relocateIssue } from '../fs/issue-store.ts';
import { withRepoLock } from '../git/lock.ts';
import {
  assetPaths,
  commitChange,
  commitMessage,
  loadConfig,
  type Operation,
  type ServiceContext,
} from './context.ts';
import { ValidationError } from './errors.ts';
import type { ExistingIssueOptions, IssueChange } from './issues.ts';
import { loadAllIssues } from './list.ts';
import { loadStoredIssue, type StoredIssue } from './load.ts';

/**
 * Link / unlink issues (`blockedBy`, `parent`; see
 * `src/core/dependencies.ts`). Only the dependent issue's file changes.
 */

/**
 * The result of link/unlink. `changed: false` when the links were already
 * as requested: nothing was written or committed (`paths: []`).
 */
export type LinkResult = IssueChange & { changed: boolean };

const sameLinks = (a: Issue, b: Issue): boolean =>
  JSON.stringify(dependencyFields(a)) === JSON.stringify(dependencyFields(b));

/** Write the issue in place (renaming a stale filename) and commit. */
async function writeLinks(
  ctx: ServiceContext,
  stored: StoredIssue,
  before: Issue,
  operation: Operation,
  config: Config,
): Promise<LinkResult> {
  const { issue } = stored;
  if (sameLinks(before, issue)) {
    return {
      changed: false,
      issue: before,
      paths: [],
      config,
      commit: null,
    };
  }
  issue.updated = new Date().toISOString();
  const paths = await relocateIssue(ctx.dir, issue, stored, {
    closed: stored.closed,
  });
  paths.push(...assetPaths(issue));
  const commit = await commitChange(ctx, config, {
    operation,
    issue,
    paths,
    message: commitMessage(config, `${operation} #${issue.id} ${issue.title}`),
  });
  return { changed: true, issue, paths, config, commit };
}

/**
 * Add links to issue `id` from untrusted `input`
 * (`{ blockedBy?: id | id[], parent?: id }`): blockers are added to
 * `blockedBy`, `parent` replaces the parent. Rejected (`invalid_input`,
 * nothing written) if a target doesn't exist, is the issue itself, or the
 * link would create a cycle. Adding links that already exist is a no-op.
 */
export async function linkIssue(
  ctx: ServiceContext,
  id: number,
  input: LinkChanges | unknown,
  options: ExistingIssueOptions = {},
): Promise<LinkResult> {
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const parsed = parseLinkChanges(input);
    if (!parsed.valid) throw new ValidationError(parsed.errors);
    const changes = parsed.values;

    // Every issue (open and closed) is needed to check targets and cycles;
    // the one being linked is taken as just loaded.
    const { issues } = await loadAllIssues(ctx.dir);
    const byId = indexIssues(issues);
    byId.set(id, stored.issue);
    const errors = validateLinks(id, changes, byId);
    if (errors.length > 0) throw new ValidationError(errors);

    const before = structuredClone(stored.issue);
    const { issue } = stored;
    if (changes.blockedBy) {
      issue.blockedBy = normalizeIdList([
        ...blockersOf(issue),
        ...changes.blockedBy,
      ]);
    }
    if (changes.parent !== undefined) issue.parent = changes.parent;
    return writeLinks(ctx, stored, before, 'link', config);
  });
}

/**
 * Remove links from issue `id` from untrusted `input`
 * (`{ blockedBy?: id | id[], parent?: true }`). Targets needn't exist (so
 * links to deleted issues can be dropped); removing links that aren't there
 * is a no-op.
 */
export async function unlinkIssue(
  ctx: ServiceContext,
  id: number,
  input: UnlinkChanges | unknown,
  options: ExistingIssueOptions = {},
): Promise<LinkResult> {
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const parsed = parseUnlinkChanges(input);
    if (!parsed.valid) throw new ValidationError(parsed.errors);
    const changes = parsed.values;

    const before = structuredClone(stored.issue);
    const { issue } = stored;
    if (changes.blockedBy) {
      const remove = new Set(changes.blockedBy);
      const kept = blockersOf(issue).filter((b) => !remove.has(b));
      if (kept.length > 0) issue.blockedBy = kept;
      else delete issue.blockedBy;
    }
    if (changes.parent) delete issue.parent;
    return writeLinks(ctx, stored, before, 'unlink', config);
  });
}
