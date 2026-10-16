import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { blockersOf } from '../core/dependencies.ts';
import { GitracError, issueNotFound } from '../core/errors.ts';
import { normalizeIdList, parseIssueFile } from '../core/issue.ts';
import type { Config, Issue } from '../core/types.ts';
import { isClosedStatus } from '../core/workflow.ts';
import { findIssueFiles, relocateIssue } from '../fs/issue-store.ts';
import { allocateIssueId } from '../git/ids.ts';
import { withRepoLock } from '../git/lock.ts';
import {
  assetPaths,
  commitChange,
  commitMessage,
  identityName,
  loadConfig,
  type ServiceContext,
} from './context.ts';
import { IssueUnreadableError } from './errors.ts';
import { loadAllIssues } from './list.ts';
import { linkingIssues, linksTo } from './references.ts';

/** One of the files that have an issue ID. */
export interface RenumberCandidate {
  /** Repo-relative path (`.issues/[closed/]<id>-<slug>.md`). */
  path: string;
  filename: string;
  /** Whether it is in `.issues/closed/`. */
  closed: boolean;
  /** Its title, or null if the file can't be read or parsed. */
  title: string | null;
}

/** Another issue that references the renumbered ID. */
export interface RenumberReference {
  id: number;
  title: string;
  /** The old ID is (was) in its `blockedBy`. */
  blockedBy: boolean;
  /** Its `parent` is (was) the old ID. */
  parent: boolean;
  /** Its description or a comment mentions `#<old ID>` (never rewritten). */
  mentions: boolean;
  /** Its `blockedBy` / `parent` links were rewritten to the new ID. */
  updated: boolean;
  /** Repo-relative paths of its rewritten file (empty unless `updated`). */
  paths: string[];
}

/** The result of {@link renumberIssue}. */
export interface IssueRenumbering {
  oldId: number;
  newId: number;
  /** The issue as written, with its new ID. */
  issue: Issue;
  /** Repo-relative path of the file that was renumbered. */
  from: string;
  /** Repo-relative path it was moved to. */
  to: string;
  /**
   * Other issues (open or closed) that link to the old ID (`blockedBy` /
   * `parent`) or mention `#<old ID>`, by ID. Since the old ID was ambiguous,
   * they are only rewritten with `updateRefs` (links only, never mentions).
   */
  references: RenumberReference[];
  /** Every path in the commit. */
  paths: string[];
  config: Config;
  /** The new commit's hash, or null if nothing was committed. */
  commit: string | null;
}

export interface RenumberOptions {
  /**
   * The file to renumber: a repo-relative path (as listed by
   * `duplicate_issue`) or a bare filename. Required when several files have
   * the ID.
   */
  file?: string;
  /** Renumber even though only one file has the ID. */
  force?: boolean;
  /** Rewrite other issues' `blockedBy` / `parent` links to the new ID. */
  updateRefs?: boolean;
  /**
   * Called once the files are written, before committing (with
   * `commit: null`), so a caller can report the result even if the commit
   * then fails.
   */
  onRenumbered?: (renumbering: IssueRenumbering) => void;
}

/**
 * The files that have issue ID `id` (normally one; several after e.g. two
 * clones created the same ID), each with its title if it can be parsed.
 * Read-only; no lock.
 */
export async function renumberCandidates(
  dir: string,
  id: number,
): Promise<RenumberCandidate[]> {
  const files = await findIssueFiles(dir, id);
  return Promise.all(
    files.map(async ({ filename, closed, path }) => {
      let title: string | null = null;
      try {
        const content = await readFile(join(dir, path), 'utf-8');
        title = parseIssueFile(content, { id, path }).title;
      } catch {
        // Unreadable or malformed: still a candidate, just untitled.
      }
      return { path, filename, closed, title };
    }),
  );
}

/** `path ("title")`, for messages. */
function describe(c: RenumberCandidate): string {
  return c.title === null ? c.path : `${c.path} ("${c.title}")`;
}

/** The candidate `file` names (by repo-relative path or bare filename). */
function selectCandidate(
  id: number,
  candidates: RenumberCandidate[],
  file: string,
): RenumberCandidate {
  const wanted = normalize(file.trim());
  let matches = candidates.filter((c) => normalize(c.path) === wanted);
  if (matches.length === 0) {
    matches = candidates.filter((c) => c.filename === wanted);
  }
  const files = candidates.map((c) => c.path);
  if (matches.length === 1) return matches[0] as RenumberCandidate;
  if (matches.length > 1) {
    throw new GitracError(
      'invalid_input',
      `"${file}" matches several files of issue #${id}: ${matches.map((c) => c.path).join(', ')}. Give the path.`,
      { details: { id, files } },
    );
  }
  throw new GitracError(
    'invalid_input',
    `"${file}" is not a file of issue #${id}. Its files: ${files.join(', ')}.`,
    { details: { id, files } },
  );
}

/** Whether `text` mentions `#<id>` (not e.g. `#123` for 12, or `&#12;`). */
function mentions(text: string, id: number): boolean {
  return new RegExp(`(?<![\\w&#])#${id}(?!\\w)`).test(text);
}

function mentionsIn(issue: Issue, id: number): boolean {
  return [issue.description, ...issue.comments.map((c) => c.body)].some(
    (text) => mentions(text, id),
  );
}

/** The comment {@link renumberIssue} adds to the renumbered issue. */
export function renumberedComment(oldId: number, duplicated: boolean): string {
  return duplicated
    ? `Renumbered from #${oldId} (duplicate ID).`
    : `Renumbered from #${oldId}.`;
}

/**
 * Give one file of issue `id` a fresh ID: the next one from the normal
 * allocator (`allocateIssueId`), so it is unique across worktrees and every
 * known ref. The file is renamed to `<newId>-<slug>.md` (in the same
 * directory) with its frontmatter `id` changed, `updated` bumped and a
 * `Renumbered from #<old>` comment (by the context's identity) appended, and
 * the change is committed (`issue: renumber #<old> -> #<new> <title>`) per the
 * context's commit options.
 *
 * Meant for duplicate IDs (two clones created the same one): with several
 * files, `options.file` picks the one to renumber (else `duplicate_issue`,
 * listing them with their titles in `candidates`). If only one file has the
 * ID it is refused (`invalid_state`) unless `options.force`.
 *
 * References to the old ID — `blockedBy` / `parent` links and `#<id>`
 * mentions in other issues — are ambiguous, so they are only reported
 * (`references`); with `options.updateRefs` the links (not the mentions) are
 * rewritten to the new ID, bumping those issues' `updated`, in the same
 * commit.
 */
export async function renumberIssue(
  ctx: ServiceContext,
  id: number,
  options: RenumberOptions = {},
): Promise<IssueRenumbering> {
  return withRepoLock(ctx.dir, async () => {
    const config = await loadConfig(ctx);
    // The author of the renumber comment. Check it before anything else.
    const author = await identityName(ctx);
    const candidates = await renumberCandidates(ctx.dir, id);
    if (candidates.length === 0) throw issueNotFound(id);
    const files = candidates.map((c) => c.path);
    if (options.file === undefined && candidates.length > 1) {
      throw new GitracError(
        'duplicate_issue',
        `Issue #${id} has ${candidates.length} files: ${candidates.map(describe).join(', ')}. Pick the one to renumber.`,
        { details: { id, files, candidates } },
      );
    }
    const chosen =
      options.file === undefined
        ? (candidates[0] as RenumberCandidate)
        : selectCandidate(id, candidates, options.file);
    if (candidates.length === 1 && !options.force) {
      throw new GitracError(
        'invalid_state',
        `Issue #${id} is not duplicated (its only file is ${chosen.path}); renumbering it changes its ID.`,
        { details: { id, files } },
      );
    }

    let issue: Issue;
    try {
      const content = await readFile(join(ctx.dir, chosen.path), 'utf-8');
      issue = parseIssueFile(content, { id, path: chosen.path });
    } catch (err) {
      if (err instanceof GitracError) throw err;
      throw new IssueUnreadableError(id, err);
    }

    // Everything that references the old ID (except its own files).
    const { issues } = await loadAllIssues(ctx.dir);
    const referencing = issues
      .filter((other) => other.id !== id)
      .map((other) => ({ other, links: linksTo(other, id) }))
      .filter(
        ({ other, links }) =>
          links.blockedBy || links.parent || mentionsIn(other, id),
      )
      .sort((a, b) => a.other.id - b.other.id);
    // Loaded fresh (a duplicate/malformed linking issue fails here, before
    // anything is written or an ID allocated).
    const relinks = options.updateRefs ? await linkingIssues(ctx.dir, id) : [];

    const newId = await allocateIssueId(ctx.dir);
    const now = new Date().toISOString();
    issue.id = newId;
    issue.updated = now;
    // Record where it came from: old `#<id>` mentions elsewhere (and in
    // history) still point at the old ID.
    issue.comments.push({
      author,
      timestamp: now,
      body: renumberedComment(id, candidates.length > 1),
    });
    // The ID is in the filename, so this is always a rename: [new, old].
    const moved = await relocateIssue(ctx.dir, issue, chosen, {
      closed: isClosedStatus(config, issue.status),
    });
    const to = moved[0] as string;
    const committed = new Set<string>(moved);

    const rewritten = new Map<number, string[]>();
    for (const { stored, blockedBy, parent } of relinks) {
      const other = stored.issue;
      if (blockedBy) {
        other.blockedBy = normalizeIdList(
          blockersOf(other).map((b) => (b === id ? newId : b)),
        );
      }
      if (parent) other.parent = newId;
      other.updated = now;
      const paths = await relocateIssue(ctx.dir, other, stored, {
        closed: isClosedStatus(config, other.status),
      });
      rewritten.set(other.id, paths);
      for (const p of [...paths, ...assetPaths(other)]) committed.add(p);
    }
    for (const p of assetPaths(issue)) committed.add(p);

    const references: RenumberReference[] = referencing.map(
      ({ other, links }) => {
        const paths = rewritten.get(other.id) ?? [];
        return {
          id: other.id,
          title: other.title,
          blockedBy: links.blockedBy,
          parent: links.parent,
          mentions: mentionsIn(other, id),
          updated: paths.length > 0,
          paths,
        };
      },
    );
    const result: IssueRenumbering = {
      oldId: id,
      newId,
      issue,
      from: chosen.path,
      to,
      references,
      paths: [...committed],
      config,
      commit: null,
    };
    options.onRenumbered?.(result);
    const commit = await commitChange(ctx, config, {
      operation: 'renumber',
      issue,
      paths: result.paths,
      message: commitMessage(
        config,
        `renumber #${id} -> #${newId} ${issue.title}`,
      ),
    });
    return { ...result, commit };
  });
}
