import {
  ensureLabelColors,
  parseConfig,
  serializeConfig,
  validateConfig,
} from '../core/config.ts';
import {
  dependencyFields,
  parseIssue,
  pickExtraFields,
  serializeIssue,
  storedDescription,
} from '../core/issue.ts';
import type {
  Assignee,
  Comment,
  Config,
  ExtraFields,
  Issue,
  IssueFrontmatter,
} from '../core/types.ts';

/**
 * Three-way merges of gitrac's files, used by the git merge driver
 * (`gitrac merge-driver`, see `./merge-driver.ts`). Everything here is pure
 * except for the injected {@link TextMerger}.
 *
 * Conventions: `base` is the common ancestor or `null` when there is none
 * (both sides added the file), "ours" is the branch being merged into (HEAD)
 * and "theirs" the other one. When both sides changed the same value to
 * different things, issue fields go to the side with the later `updated`
 * timestamp (ties: ours); config values go to ours.
 */

/** The result of a three-way text merge. */
export interface TextMergeResult {
  text: string;
  /** True if `text` contains conflict markers. */
  conflict: boolean;
}

/**
 * A line-based three-way merge (e.g. `git merge-file`). Must leave conflict
 * markers in `text` (and set `conflict`) rather than fail.
 */
export type TextMerger = (
  base: string,
  ours: string,
  theirs: string,
) => Promise<TextMergeResult>;

/** The result of merging an issue file. */
export interface IssueMergeResult {
  /** The merged file. */
  content: string;
  /** True if the description has conflict markers left for the user. */
  conflict: boolean;
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Plain three-way pick: the side that changed `base`, or `preferred` when
 * both changed it differently (or there is no base and they differ).
 */
function pick3<T>(
  base: T | undefined,
  hasBase: boolean,
  ours: T,
  theirs: T,
  preferred: 'ours' | 'theirs' = 'ours',
): T {
  if (same(ours, theirs)) return ours;
  if (hasBase) {
    if (same(ours, base)) return theirs;
    if (same(theirs, base)) return ours;
  }
  return preferred === 'ours' ? ours : theirs;
}

/** Compare two ISO timestamps (invalid ones fall back to string order). */
function compareTimestamps(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Three-way merge of a set (labels, blockedBy): additions and removals from both sides. */
function mergeSet<T extends string | number>(
  base: T[] | null,
  ours: T[],
  theirs: T[],
): T[] {
  const baseSet = new Set(base ?? []);
  const oursSet = new Set(ours);
  const theirsSet = new Set(theirs);
  const result: T[] = [];
  for (const item of [...ours, ...theirs]) {
    if (result.includes(item)) continue;
    // Removed by a side that had it in base: drop it.
    if (baseSet.has(item) && (!oursSet.has(item) || !theirsSet.has(item))) {
      continue;
    }
    result.push(item);
  }
  return result;
}

/**
 * Three-way merge of the unknown frontmatter keys ({@link Issue.extra}), per
 * key: a key added, changed or removed on one side takes that change; both
 * changed it differently: the `newer` side's value; removed on one side but
 * changed on the other: the change is kept. Ours' key order first, then keys
 * only theirs has. Values keep their source text ({@link pickExtraFields}).
 */
function mergeExtra(
  base: ExtraFields | null,
  ours: ExtraFields,
  theirs: ExtraFields,
  newer: 'ours' | 'theirs',
): ExtraFields | undefined {
  const picks: [string, ExtraFields][] = [];
  for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const inOurs = Object.hasOwn(ours, key);
    const inTheirs = Object.hasOwn(theirs, key);
    const inBase = base !== null && Object.hasOwn(base, key);
    const baseValue = inBase ? base[key] : undefined;
    if (inOurs && inTheirs) {
      const o = ours[key];
      const t = theirs[key];
      if (same(o, t) || (inBase && same(t, baseValue))) {
        picks.push([key, ours]);
      } else if (inBase && same(o, baseValue)) {
        picks.push([key, theirs]);
      } else {
        picks.push([key, newer === 'ours' ? ours : theirs]);
      }
    } else {
      const side = inOurs ? ours : theirs;
      // Removed on the other side: drop it unless this side changed it.
      if (inBase && same(side[key], baseValue)) continue;
      picks.push([key, side]);
    }
  }
  return pickExtraFields(picks);
}

/**
 * Per-field three-way merge for issue frontmatter:
 *
 * - A field changed on one side only takes that side's value.
 * - A field both sides changed differently takes the value of the side that
 *   was updated last (`updated`; ties and unparsable dates: ours) — per-field
 *   last-writer-wins.
 * - `labels` and `blockedBy` are merged as sets: items added on either side
 *   are kept, items removed on either side are dropped. `parent` is an
 *   ordinary field.
 * - `updated` is the later of the two.
 * - Unknown keys (`extra`) merge per key, the same way ({@link mergeExtra}).
 *
 * `base` is null when both sides added the file independently.
 */
export function mergeIssueFrontmatter(
  ours: IssueFrontmatter,
  theirs: IssueFrontmatter,
  base: IssueFrontmatter | null,
): IssueFrontmatter {
  const newer: 'ours' | 'theirs' =
    compareTimestamps(theirs.updated, ours.updated) > 0 ? 'theirs' : 'ours';
  const hasBase = base !== null;
  const field = <K extends keyof IssueFrontmatter>(
    key: K,
  ): IssueFrontmatter[K] =>
    pick3(base?.[key], hasBase, ours[key], theirs[key], newer);

  const merged: IssueFrontmatter = {
    id: field('id'),
    title: field('title'),
    status: field('status'),
    priority: field('priority'),
    assignee: field('assignee'),
    labels: mergeSet(base?.labels ?? null, ours.labels, theirs.labels),
    // Only present when set, like in parsed issues (so it round-trips).
    ...dependencyFields({
      parent: field('parent'),
      blockedBy: mergeSet(
        base ? (base.blockedBy ?? []) : null,
        ours.blockedBy ?? [],
        theirs.blockedBy ?? [],
      ),
    }),
    created: field('created'),
    createdBy: field('createdBy'),
    updated: newer === 'theirs' ? theirs.updated : ours.updated,
  };
  const extra = mergeExtra(
    base ? (base.extra ?? {}) : null,
    ours.extra ?? {},
    theirs.extra ?? {},
    newer,
  );
  return extra ? { ...merged, extra } : merged;
}

const commentKey = (c: Comment): string => `${c.author}|${c.timestamp}`;

/**
 * Three-way merge of comments, identified by author + timestamp:
 *
 * - Comments added on either side are kept (if both added the same one with
 *   different bodies, ours wins).
 * - A comment deleted on one side is dropped, unless the other side edited it
 *   (then the edit is kept rather than lose text).
 * - A comment edited on one side takes that edit; edited on both: ours.
 *
 * The result is sorted by timestamp (stable). Without `base` this is a plain
 * union (ours wins on duplicates).
 */
export function mergeComments(
  ours: Comment[],
  theirs: Comment[],
  base: Comment[] | null = null,
): Comment[] {
  const baseMap = new Map((base ?? []).map((c) => [commentKey(c), c]));
  const oursMap = new Map(ours.map((c) => [commentKey(c), c]));
  const theirsMap = new Map(theirs.map((c) => [commentKey(c), c]));

  const merged: Comment[] = [];
  const done = new Set<string>();
  for (const c of [...ours, ...theirs]) {
    const key = commentKey(c);
    if (done.has(key)) continue;
    done.add(key);
    const b = baseMap.get(key);
    const o = oursMap.get(key);
    const t = theirsMap.get(key);
    if (!b) {
      merged.push((o ?? t) as Comment);
      continue;
    }
    if (!o || !t) {
      // Deleted on one side: keep only if the other side edited it.
      const kept = o ?? t;
      if (kept && kept.body !== b.body) merged.push(kept);
      continue;
    }
    merged.push(pick3(b, true, o, t));
  }

  merged.sort((a, b) => compareTimestamps(a.timestamp, b.timestamp));
  return merged;
}

/** A line that starts a git conflict block (`<<<<<<<`, `=======`, ...). */
const CONFLICT_MARKER_RE = /^(<{7,}|>{7,}|\|{7,})( |$)/m;

/**
 * Parse an issue file strictly enough that merging it can't silently lose
 * data: it must have frontmatter, a positive integer id and a title, and no
 * leftover conflict markers. Throws otherwise.
 */
function parseIssueForMerge(content: string, side: string): Issue {
  if (!/^---\r?\n/.test(content)) {
    throw new Error(`${side}: missing frontmatter`);
  }
  if (CONFLICT_MARKER_RE.test(content)) {
    throw new Error(`${side}: contains conflict markers`);
  }
  const issue = parseIssue(content);
  if (!Number.isInteger(issue.id) || issue.id <= 0) {
    throw new Error(`${side}: invalid id`);
  }
  if (!issue.title.trim()) {
    throw new Error(`${side}: missing title`);
  }
  return issue;
}

function frontmatterOf(issue: Issue): IssueFrontmatter {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    assignee: issue.assignee,
    labels: issue.labels,
    ...dependencyFields(issue),
    created: issue.created,
    createdBy: issue.createdBy,
    updated: issue.updated,
    ...(issue.extra ? { extra: issue.extra } : {}),
  };
}

/** A {@link TextMerger} that conflicts whenever both sides differ. */
const wholeTextMerger: TextMerger = async (base, ours, theirs) => ({
  text: ours,
  conflict: ours !== theirs && ours !== base && theirs !== base,
});

/**
 * Merge two versions of an issue file against their common ancestor
 * (`base`; empty for an add/add conflict): frontmatter per field
 * ({@link mergeIssueFrontmatter}), comments three-way
 * ({@link mergeComments}), and the description with `mergeText` (a
 * line-based merge such as `git merge-file`) when both sides changed it —
 * leaving its conflict markers in the description, and `conflict: true`,
 * if it can't be merged cleanly.
 *
 * Throws if a version can't be parsed as an issue (no frontmatter, bad id,
 * leftover conflict markers), if the versions are for different issue IDs, or
 * if the result wouldn't read back identically; callers then fall back to a
 * plain text merge.
 */
export async function mergeIssueFiles(
  baseContent: string,
  oursContent: string,
  theirsContent: string,
  mergeText: TextMerger = wholeTextMerger,
): Promise<IssueMergeResult> {
  if (oursContent === theirsContent || theirsContent === baseContent) {
    return { content: oursContent, conflict: false };
  }
  if (oursContent === baseContent) {
    return { content: theirsContent, conflict: false };
  }

  const ours = parseIssueForMerge(oursContent, 'ours');
  const theirs = parseIssueForMerge(theirsContent, 'theirs');
  const base = baseContent.trim()
    ? parseIssueForMerge(baseContent, 'base')
    : null;
  if (ours.id !== theirs.id || (base && base.id !== ours.id)) {
    throw new Error('the versions are for different issue IDs');
  }

  let description: string;
  let conflict = false;
  const baseDescription = base?.description ?? '';
  if (ours.description === theirs.description) {
    description = ours.description;
  } else if (base && ours.description === baseDescription) {
    description = theirs.description;
  } else if (base && theirs.description === baseDescription) {
    description = ours.description;
  } else {
    // Both changed it: line-based merge. Terminate each with a newline so a
    // last-line change merges like any other line.
    const merged = await mergeText(
      base ? `${baseDescription}\n` : '',
      `${ours.description}\n`,
      `${theirs.description}\n`,
    );
    description = merged.text.replace(/\n$/, '');
    conflict = merged.conflict;
  }

  const comments = mergeComments(
    ours.comments,
    theirs.comments,
    base?.comments ?? null,
  );
  const issue: Issue = {
    ...mergeIssueFrontmatter(
      frontmatterOf(ours),
      frontmatterOf(theirs),
      base ? frontmatterOf(base) : null,
    ),
    // Use the description as it reads back from the file. The text merge
    // can leave blank lines at the ends. A side without comments can leave
    // a code fence open, and the serializer closes it when comments follow.
    description: storedDescription(description, comments.length > 0),
    comments,
  };
  const content = serializeIssue(issue);

  // Never hand git a file that reads back as something else.
  if (!same(parseIssue(content), issue)) {
    throw new Error('the merged issue does not round-trip');
  }
  return { content, conflict };
}

/**
 * Resolve an issue conflict by parsing all three versions, merging
 * frontmatter and comments, and checking description conflicts.
 * Returns null if both sides changed the description differently.
 * See {@link mergeIssueFiles} (which can also line-merge descriptions).
 */
export async function resolveIssueConflict(
  oursContent: string,
  theirsContent: string,
  baseContent: string,
): Promise<string | null> {
  const result = await mergeIssueFiles(baseContent, oursContent, theirsContent);
  return result.conflict ? null : result.content;
}

/** Three-way merge of a name -> value map (keys added/removed on either side). */
function mergeRecord<T>(
  base: Record<string, T> | null,
  ours: Record<string, T>,
  theirs: Record<string, T>,
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const inOurs = Object.hasOwn(ours, key);
    const inTheirs = Object.hasOwn(theirs, key);
    const inBase = base !== null && Object.hasOwn(base, key);
    if (inOurs && inTheirs) {
      result[key] = pick3(
        base?.[key],
        inBase,
        ours[key] as T,
        theirs[key] as T,
      );
    } else {
      const value = (inOurs ? ours[key] : theirs[key]) as T;
      // Removed on the other side: drop it unless this side changed it.
      if (inBase && same(value, base?.[key])) continue;
      result[key] = value;
    }
  }
  return result;
}

/**
 * Merge label colors ({@link mergeRecord}). Each side picks unused palette
 * colors for the labels it adds, so labels added on their side can collide
 * with ours; those get a fresh color.
 */
function mergeLabels(
  base: Record<string, string> | null,
  ours: Record<string, string>,
  theirs: Record<string, string>,
): Record<string, string> {
  const merged = mergeRecord(base, ours, theirs);
  const recolor = Object.keys(merged).filter(
    (name) =>
      !Object.hasOwn(ours, name) &&
      Object.entries(merged).some(
        ([other, color]) => other !== name && color === merged[name],
      ),
  );
  if (recolor.length === 0) return merged;
  const kept = Object.fromEntries(
    Object.entries(merged).filter(([name]) => !recolor.includes(name)),
  );
  const colored = ensureLabelColors(recolor, kept);
  // Keep the merged order.
  return Object.fromEntries(
    Object.keys(merged).map((name) => [name, colored[name] as string]),
  );
}

function assigneeMap(assignees: Assignee[]): Record<string, Assignee> {
  const map: Record<string, Assignee> = {};
  for (const a of assignees) {
    const key = a.email.trim().toLowerCase();
    if (!Object.hasOwn(map, key)) map[key] = a;
  }
  return map;
}

/**
 * Merge two versions of `.issues/config.yaml` against their common ancestor
 * (`base`; empty if there is none):
 *
 * - `nextId` (legacy): the larger of the two.
 * - `labels`: union; a label removed on one side (and not recolored on the
 *   other) is dropped; a color changed on one side wins, changed on both: ours.
 * - `assignees`: union deduplicated by email (case-insensitive), ours' order
 *   first; removals and renames merge like labels.
 * - `git.*` and every other key: three-way per value, ours on conflict.
 *
 * Throws if a version isn't a valid config; callers then fall back to a plain
 * text merge.
 */
export function mergeConfigFiles(
  baseContent: string,
  oursContent: string,
  theirsContent: string,
): string {
  if (oursContent === theirsContent || theirsContent === baseContent) {
    return oursContent;
  }
  if (oursContent === baseContent) return theirsContent;

  for (const content of [baseContent, oursContent, theirsContent]) {
    if (CONFLICT_MARKER_RE.test(content)) {
      throw new Error('config contains conflict markers');
    }
  }
  const ours = parseConfig(oursContent) as Config & Record<string, unknown>;
  const theirs = parseConfig(theirsContent) as Config & Record<string, unknown>;
  const base = baseContent.trim()
    ? (parseConfig(baseContent) as Config & Record<string, unknown>)
    : null;

  const result: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(ours), ...Object.keys(theirs)]);
  for (const key of keys) {
    switch (key) {
      case 'nextId': {
        const ids = [ours.nextId, theirs.nextId].filter(
          (n): n is number => typeof n === 'number',
        );
        if (ids.length > 0) result.nextId = Math.max(...ids);
        break;
      }
      case 'labels':
        result.labels = mergeLabels(
          base?.labels ?? null,
          ours.labels,
          theirs.labels,
        );
        break;
      case 'assignees':
        result.assignees = Object.values(
          mergeRecord(
            base ? assigneeMap(base.assignees) : null,
            assigneeMap(ours.assignees),
            assigneeMap(theirs.assignees),
          ),
        );
        break;
      case 'git':
        result.git = mergeRecord(
          (base?.git ?? null) as Record<string, unknown> | null,
          ours.git as unknown as Record<string, unknown>,
          theirs.git as unknown as Record<string, unknown>,
        );
        break;
      default: {
        const value = pick3(base?.[key], base !== null, ours[key], theirs[key]);
        if (value !== undefined) result[key] = value;
      }
    }
  }

  if (!validateConfig(result)) {
    throw new Error('the merged config is invalid');
  }
  const content = serializeConfig(result);
  parseConfig(content); // must read back
  return content;
}
