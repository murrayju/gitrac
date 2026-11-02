import {
  edgeKey,
  edgeOf,
  homeOf,
  type IssueEdge,
  isIssueLink,
  issueLinkError,
  type Link,
  LinkGraph,
  type LinkSelector,
  linkFor,
  linkKey,
  parseLinkRequest,
  replacedEdges,
  selects,
  uniqueLinks,
} from '../core/links.ts';
import { nextTimestamp } from '../core/timestamp.ts';
import type { Config, Issue } from '../core/types.ts';
import { isClosedStatus } from '../core/workflow.ts';
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
 * Link / unlink an issue (`links`; see `src/core/links.ts`). A link to
 * another issue is written on its home (`homeOf`: the blocked issue, the
 * sub-issue, the duplicate, the higher ID of two related issues), which can
 * be the other issue's file; removing (or replacing) one rewrites whichever
 * file stores it. URL and other links stay on the issue they are added to.
 */

/**
 * The result of link/unlink. `changed: false` when the links were already
 * as requested: nothing was written or committed (`paths: []`).
 */
export type LinkResult = IssueChange & { changed: boolean };

/** What {@link editLinks} changed, in memory. */
export interface LinkEdit {
  /** Whether the issue's own links changed. */
  changed: boolean;
  /** Other issues whose stored links changed (loaded fresh). */
  others: StoredIssue[];
}

const linksJson = (issue: Pick<Issue, 'links'>): string =>
  JSON.stringify(issue.links ?? []);

/** Set `issue.links` (absent when empty). */
function setLinks(issue: Issue, links: Link[]): void {
  const unique = uniqueLinks(links);
  if (unique.length > 0) issue.links = unique;
  else delete issue.links;
}

/** Drop the links of `issue` that stand for one of the edges in `keys`. */
function dropEdges(issue: Issue, keys: ReadonlySet<string>): void {
  setLinks(
    issue,
    (issue.links ?? []).filter(
      (link) =>
        !isIssueLink(link) || !keys.has(edgeKey(edgeOf(issue.id, link))),
    ),
  );
}

/**
 * Change the links of `stored` (loaded under the repo lock), in memory:
 * remove the links `remove` selects, then add `add`. A link to another issue
 * is written on its home (`homeOf`), as the relationship seen from there
 * (`blocks` from #3 to #5 is `blockedBy: 3` on #5). One that already exists
 * (stored on either issue) is not added again, and a new parent or original
 * (`duplicateOf`) replaces the old one. Throws a
 * {@link ValidationError} (nothing changed on disk) if an added issue link
 * points at the issue itself, a missing issue, or closes a cycle (see
 * `issueLinkError`). Returns what changed; the caller writes it.
 */
export async function editLinks(
  dir: string,
  stored: StoredIssue,
  add: readonly Link[],
  remove: readonly LinkSelector[] = [],
): Promise<LinkEdit> {
  const { issue } = stored;
  const before = linksJson(issue);
  const { issues: loaded } = await loadAllIssues(dir);
  // Work on copies of the others; this issue is the one just loaded.
  const issues = [
    ...loaded.filter((i) => i.id !== issue.id).map((i) => structuredClone(i)),
    issue,
  ];
  const byId = new Map(issues.map((i) => [i.id, i]));
  const touched = new Set<number>();
  const removeEdges = (edges: IssueEdge[]) => {
    if (edges.length === 0) return;
    const keys = new Set(edges.map(edgeKey));
    for (const edge of edges) {
      for (const end of [edge.from, edge.to]) {
        const other = byId.get(end);
        if (!other) continue;
        const was = linksJson(other);
        dropEdges(other, keys);
        if (other !== issue && linksJson(other) !== was) touched.add(end);
      }
    }
  };

  for (const selector of remove) {
    if ('key' in selector) {
      setLinks(
        issue,
        (issue.links ?? []).filter((link) => linkKey(link) !== selector.key),
      );
      continue;
    }
    const graph = new LinkGraph(issues);
    removeEdges(
      graph.edges.filter(
        (edge) =>
          (edge.from === issue.id || edge.to === issue.id) &&
          selects(selector, issue.id, edge),
      ),
    );
  }

  const errors: string[] = [];
  for (const link of add) {
    if (!isIssueLink(link)) {
      setLinks(issue, [...(issue.links ?? []), link]);
      continue;
    }
    const edge = edgeOf(issue.id, link);
    const valid = link.id !== issue.id && byId.has(link.id);
    if (valid) {
      const graph = new LinkGraph(issues);
      if (graph.has(edge)) continue;
      // Check for a cycle without the edges the new one replaces.
      removeEdges(replacedEdges(graph, edge));
    }
    const error = issueLinkError(issue.id, link, new LinkGraph(issues), (id) =>
      byId.has(id),
    );
    if (error) {
      errors.push(error);
      continue;
    }
    const home = homeOf(edge);
    const homeIssue = byId.get(home) as Issue;
    setLinks(homeIssue, [...(homeIssue.links ?? []), linkFor(home, edge)]);
    if (homeIssue !== issue) touched.add(home);
  }
  if (errors.length > 0) throw new ValidationError(errors);

  const others: StoredIssue[] = [];
  for (const id of [...touched].sort((a, b) => a - b)) {
    const other = await loadStoredIssue(dir, id);
    other.issue.links = byId.get(id)?.links;
    if (!other.issue.links) delete other.issue.links;
    others.push(other);
  }
  return { changed: linksJson(issue) !== before, others };
}

/**
 * Write the other issues of a {@link LinkEdit} (moving a misplaced file);
 * returns the paths to commit. Their `updated` stays as it is: a link added
 * from another issue is not activity on them (it must not make a claim on
 * them look renewed), and a newer `updated` here would supersede a claim on
 * them in another worktree or on another branch. Links merge as a set, so
 * the merge driver does not need it either.
 */
export async function writeOthers(
  dir: string,
  config: Config,
  others: readonly StoredIssue[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const other of others) {
    paths.push(
      ...(await relocateIssue(dir, other.issue, other, {
        closed: isClosedStatus(config, other.issue.status),
      })),
      ...assetPaths(other.issue),
    );
  }
  return paths;
}

/** Write the issue and the other issues of `edit`, then commit. */
async function writeEdit(
  ctx: ServiceContext,
  stored: StoredIssue,
  before: Issue,
  edit: LinkEdit,
  operation: Operation,
  config: Config,
): Promise<LinkResult> {
  const { issue } = stored;
  if (!edit.changed && edit.others.length === 0) {
    return { changed: false, issue: before, paths: [], config, commit: null };
  }
  const paths: string[] = [];
  if (edit.changed) {
    issue.updated = nextTimestamp([issue.updated]);
    // Write to the directory the status requires (repairs a misplaced file).
    paths.push(
      ...(await relocateIssue(ctx.dir, issue, stored, {
        closed: isClosedStatus(config, issue.status),
      })),
      ...assetPaths(issue),
    );
  }
  paths.push(...(await writeOthers(ctx.dir, config, edit.others)));
  const commit = await commitChange(ctx, config, {
    operation,
    issue,
    paths,
    message: commitMessage(config, `${operation} #${issue.id} ${issue.title}`),
  });
  return { changed: true, issue, paths, config, commit };
}

/**
 * Add links to issue `id` from untrusted `input` (`{ links: [...] }`, see
 * `parseLinkRequest`); a link to another issue is written on its home,
 * which can be the other issue (see {@link editLinks}). Rejected (`invalid_input`, nothing written) for a bad
 * link, or an issue link to the issue itself, to a missing issue, or that
 * would create a cycle. A new parent or `duplicateOf` replaces the old one
 * (also when the other issue stores it). Links that already exist are a
 * no-op.
 */
export async function linkIssue(
  ctx: ServiceContext,
  id: number,
  input: unknown,
  options: ExistingIssueOptions = {},
): Promise<LinkResult> {
  const parsed = parseLinkRequest(input, 'link');
  if ('errors' in parsed) throw new ValidationError(parsed.errors);
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const before = structuredClone(stored.issue);
    const edit = await editLinks(ctx.dir, stored, parsed.links);
    return writeEdit(ctx, stored, before, edit, 'link', config);
  });
}

/**
 * Remove links from issue `id` from untrusted `input` (`{ links: [...] }`;
 * an issue link without `id` removes every link of that relationship). A
 * link to another issue is removed whichever issue stores it. Targets needn't
 * exist (so links to deleted issues can be dropped); removing links that
 * aren't there is a no-op.
 */
export async function unlinkIssue(
  ctx: ServiceContext,
  id: number,
  input: unknown,
  options: ExistingIssueOptions = {},
): Promise<LinkResult> {
  const parsed = parseLinkRequest(input, 'unlink');
  if ('errors' in parsed) throw new ValidationError(parsed.errors);
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    const stored = await loadStoredIssue(ctx.dir, id, options.precondition);
    const before = structuredClone(stored.issue);
    const edit = await editLinks(ctx.dir, stored, [], parsed.links);
    return writeEdit(ctx, stored, before, edit, 'unlink', config);
  });
}
