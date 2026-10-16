import matter from 'gray-matter';
import yaml from 'js-yaml';
import {
  COMMENT_HEADER_RE,
  escapeCommentHeaderLine,
  parseComments,
  serializeComments,
  unescapeCommentHeaderLine,
} from './comments.ts';
import { GitracError } from './errors.ts';
import { scanFences } from './fences.ts';
import { splitLines } from './lines.ts';
import type {
  ExtraFields,
  Issue,
  IssueFrontmatter,
  Priority,
  Status,
} from './types.ts';

/**
 * gray-matter options used when parsing issue files.
 *
 * - The YAML engine uses js-yaml's CORE_SCHEMA, which has no timestamp
 *   type. With gray-matter's default schema an unquoted
 *   `created: 2026-03-28T12:00:00Z` becomes a `Date` object instead of a
 *   string; CORE_SCHEMA keeps it verbatim (and also keeps e.g. a title like
 *   `2026-03-28` as written). It is also a safe schema (no `!!js/*` types).
 * - Passing any options object disables gray-matter's module-level cache,
 *   which is keyed by the input string and would otherwise hand the *same*
 *   `data` object (and `labels` array) to every caller parsing identical
 *   content, and grows without bound in a long-running server.
 */
const MATTER_OPTIONS = {
  engines: {
    yaml: (input: string): object =>
      (yaml.load(input, { schema: yaml.CORE_SCHEMA }) ?? {}) as object,
  },
};

/** The frontmatter keys gitrac knows; everything else goes to `extra`. */
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'id',
  'title',
  'status',
  'priority',
  'assignee',
  'labels',
  'parent',
  'blockedBy',
  'created',
  'createdBy',
  'updated',
]);

/** The YAML text an unknown key was read from, and the value it parsed to. */
interface ExtraSource {
  text: string;
  value: unknown;
}

/**
 * The source text of each key of an `extra` object (in file order), so an
 * unchanged unknown key is written back exactly as it was read — quoting,
 * flow style, comments and all — rather than re-dumped. Keyed by the
 * `extra` object itself, so it follows the issue through every in-place
 * mutation and `{ ...issue }` copy without showing up in JSON output.
 */
const extraSources = new WeakMap<object, Map<string, ExtraSource>>();

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An own-property lookup (safe for keys like `__proto__`). */
const ownValue = (record: object, key: string): unknown =>
  Object.getOwnPropertyDescriptor(record, key)?.value;

/**
 * Split raw frontmatter YAML into one text block per top-level key: a line
 * starting in column 0 (not a comment or a `- ` sequence entry) starts a
 * key; comment lines just before it belong to it; blank lines at the edges
 * are dropped.
 */
function topLevelBlocks(raw: string): string[] {
  const blocks: string[][] = [];
  let pending: string[] = [];
  for (const line of splitLines(raw)) {
    if (line.trim() === '' || line.startsWith('#')) {
      pending.push(line);
    } else if (/^(?![\s#]|-(?:\s|$))/.test(line)) {
      blocks.push([...pending, line]);
      pending = [];
    } else {
      blocks.at(-1)?.push(...pending, line);
      pending = [];
    }
  }
  blocks.at(-1)?.push(...pending);
  return blocks.map((lines) => lines.join('\n').trim());
}

/**
 * The source text of every unknown key of the frontmatter `data` parsed from
 * `raw`, in file order — or null if `raw` can't be split into independent
 * per-key blocks that each parse to exactly the key's value (anchors and
 * aliases across keys, multi-line flow values in column 0, ...). Then the
 * values are re-dumped on write instead.
 */
function extraSourcesOf(
  raw: string,
  data: Record<string, unknown>,
): Map<string, ExtraSource> | null {
  const sources = new Map<string, ExtraSource>();
  const seen = new Set<string>();
  for (const text of topLevelBlocks(raw)) {
    let parsed: unknown;
    try {
      parsed = yaml.load(text, { schema: yaml.CORE_SCHEMA });
    } catch {
      return null;
    }
    if (!isPlainObject(parsed)) return null;
    const keys = Object.keys(parsed);
    const key = keys[0];
    if (keys.length !== 1 || key === undefined || seen.has(key)) return null;
    const value = ownValue(parsed, key);
    if (!Object.hasOwn(data, key)) return null;
    if (!Bun.deepEquals(value, ownValue(data, key), true)) return null;
    seen.add(key);
    if (!KNOWN_KEYS.has(key)) sources.set(key, { text, value });
  }
  return seen.size === Object.keys(data).length ? sources : null;
}

/**
 * The unknown keys of the frontmatter `data` (parsed from `raw`), in file
 * order, or undefined if there are none.
 */
function extraFieldsOf(
  raw: string,
  data: Record<string, unknown>,
): ExtraFields | undefined {
  const keys = Object.keys(data).filter((key) => !KNOWN_KEYS.has(key));
  if (keys.length === 0) return undefined;
  const sources = extraSourcesOf(raw, data);
  const ordered = sources ? [...sources.keys()] : keys;
  const extra: ExtraFields = Object.fromEntries(
    ordered.map((key) => [key, ownValue(data, key)]),
  );
  if (sources) extraSources.set(extra, sources);
  return extra;
}

/**
 * Build an `extra` object from `[key, from]` picks — each key's value taken
 * from the `extra` object `from` — keeping the source text of the picked
 * keys, so they are still written back verbatim. Used by the merge driver.
 * Returns undefined when there are no picks.
 */
export function pickExtraFields(
  picks: ReadonlyArray<readonly [key: string, from: ExtraFields]>,
): ExtraFields | undefined {
  if (picks.length === 0) return undefined;
  const sources = new Map<string, ExtraSource>();
  const extra: ExtraFields = Object.fromEntries(
    picks.map(([key, from]) => {
      const source = extraSources.get(from)?.get(key);
      if (source) sources.set(key, source);
      return [key, ownValue(from, key)];
    }),
  );
  extraSources.set(extra, sources);
  return extra;
}

/**
 * YAML for the unknown keys (no trailing newline; '' if none). A key whose
 * value is unchanged since it was read is written as its source text;
 * anything else is dumped. Keys are in file order (also for integer-like keys,
 * which JS objects enumerate first), then any new ones.
 */
function serializeExtra(extra: ExtraFields | undefined): string {
  if (!extra) return '';
  const sources = extraSources.get(extra);
  const keys = new Set([
    ...[...(sources?.keys() ?? [])].filter((key) => Object.hasOwn(extra, key)),
    ...Object.keys(extra),
  ]);
  const blocks: string[] = [];
  for (const key of keys) {
    const value = ownValue(extra, key);
    if (value === undefined) continue;
    const source = sources?.get(key);
    blocks.push(
      source && Bun.deepEquals(source.value, value, true)
        ? source.text
        : yaml.dump(Object.fromEntries([[key, value]])).replace(/\n$/, ''),
    );
  }
  return blocks.join('\n');
}

/**
 * Coerce an arbitrary YAML value to a string ('' for null/undefined).
 * `Date` values (should a timestamp ever be resolved) become ISO 8601 strings.
 */
function toStringField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  return typeof value === 'string' ? value : String(value);
}

/** Coerce the id to a number (accepting numeric strings like `"7"`). */
function toIdField(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) {
    return Number(value);
  }
  return Number.NaN;
}

/**
 * Coerce labels to a fresh array of strings. A single scalar (`labels: bug`)
 * becomes a one-element array; null/undefined/empty values are dropped.
 */
function toLabelsField(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  return items.map(toStringField).filter((label) => label !== '');
}

/** A positive integer issue ID, or undefined (absent / not an ID). */
function toOptionalIdField(value: unknown): number | undefined {
  const id = toIdField(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/**
 * Coerce a list of issue IDs (`blockedBy`): a single scalar becomes a
 * one-element list, numeric strings are accepted, anything that isn't a
 * positive integer is dropped, and the result is sorted and de-duplicated.
 */
function toIdListField(value: unknown): number[] {
  if (value === null || value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  const ids = items
    .map(toOptionalIdField)
    .filter((id): id is number => id !== undefined);
  return normalizeIdList(ids);
}

/** Sort ascending and drop duplicates (the canonical `blockedBy` form). */
export function normalizeIdList(ids: readonly number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * The optional dependency fields, in frontmatter order, present only when
 * set (`parent`) / non-empty (`blockedBy`, normalized) so files without them
 * round-trip unchanged.
 */
export function dependencyFields(
  issue: Pick<Issue, 'parent' | 'blockedBy'>,
): Pick<Issue, 'parent' | 'blockedBy'> {
  const fields: Pick<Issue, 'parent' | 'blockedBy'> = {};
  if (issue.parent !== undefined) fields.parent = issue.parent;
  if (issue.blockedBy && issue.blockedBy.length > 0) {
    fields.blockedBy = normalizeIdList(issue.blockedBy);
  }
  return fields;
}

/**
 * Parse a markdown issue file into an Issue object.
 *
 * File format:
 * 1. YAML frontmatter between `---` markers
 * 2. Description (supports full markdown including headings)
 * 3. `---` separator (only present if there are comments)
 * 4. Comments section, starting with a `### author — timestamp` header
 *
 * A `---` line is only treated as the separator when it is outside a code
 * fence and the next non-blank line is a comment header, so horizontal rules
 * in the description are preserved. See {@link escapeDescription} for how
 * descriptions that would otherwise be ambiguous are written.
 */
export function parseIssue(markdown: string): Issue {
  const {
    data,
    content,
    matter: rawFrontmatter,
  } = matter(markdown, MATTER_OPTIONS);
  const fm = (isPlainObject(data) ? data : {}) as Record<string, unknown>;
  const extra = extraFieldsOf(rawFrontmatter ?? '', fm);

  // gray-matter already strips the frontmatter, so `content` starts after
  // the closing ---.
  const { description, commentsSection } = splitContent(content);

  const comments = commentsSection ? parseComments(commentsSection) : [];

  return {
    id: toIdField(fm.id),
    title: toStringField(fm.title),
    // Status/priority values are checked by validation, not here.
    status: toStringField(fm.status) as Status,
    priority: toStringField(fm.priority) as Priority,
    assignee: toStringField(fm.assignee),
    labels: toLabelsField(fm.labels),
    ...dependencyFields({
      parent: toOptionalIdField(fm.parent),
      blockedBy: toIdListField(fm.blockedBy),
    }),
    created: toStringField(fm.created),
    createdBy: toStringField(fm.createdBy),
    updated: toStringField(fm.updated),
    ...(extra ? { extra } : {}),
    description,
    comments,
  };
}

/**
 * Parse the file of issue `id` (`path`: repo-relative, for messages) and
 * check it is one gitrac can safely rewrite: it has YAML frontmatter whose
 * `id` matches the file name. Throws `invalid_issue` otherwise — e.g. a file
 * without frontmatter would otherwise read as issue `#NaN` and be rewritten
 * as `NaN-<slug>.md`.
 */
export function parseIssueFile(
  content: string,
  file: { id: number; path: string },
): Issue {
  const invalid = (reason: string, cause?: unknown) =>
    new GitracError(
      'invalid_issue',
      `Issue file ${file.path} is malformed: ${reason}. Fix or remove it.`,
      { details: { id: file.id, file: file.path }, cause },
    );
  let issue: Issue;
  try {
    issue = parseIssue(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw invalid(`invalid frontmatter (${message.split('\n')[0]})`, err);
  }
  if (Number.isNaN(issue.id)) {
    throw invalid(
      /^\uFEFF?---\r?\n/.test(content)
        ? 'missing or invalid id in the frontmatter'
        : 'no YAML frontmatter',
    );
  }
  if (issue.id !== file.id) {
    throw invalid(
      `frontmatter id ${issue.id} doesn't match the file name (#${file.id})`,
    );
  }
  return issue;
}

/**
 * Add a closing fence line to `text` if it ends inside a code fence.
 * Otherwise return `text` unchanged.
 */
export function closeOpenFence(text: string): string {
  const { open } = scanFences(splitLines(text));
  return open ? `${text}\n${open.char.repeat(open.length)}` : text;
}

/**
 * Return the description that {@link parseIssue} reads back after
 * {@link serializeIssue} writes `description`. The parser trims the
 * description. When the issue has comments, the serializer also closes a
 * code fence that the description leaves open.
 */
export function storedDescription(
  description: string,
  hasComments: boolean,
): string {
  const trimmed = description.trim();
  return hasComments ? closeOpenFence(trimmed) : trimmed;
}

/**
 * Serialize an Issue object back to a markdown file string.
 */
export function serializeIssue(issue: Issue): string {
  const frontmatter: IssueFrontmatter = {
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
  };

  let body = escapeDescription(issue.description);

  if (issue.comments.length > 0) {
    // An unclosed fence would swallow the separator and every comment, so
    // close it before appending the comments section.
    body = closeOpenFence(body);
    const commentStr = serializeComments(issue.comments);
    body = `${body}\n\n${SEPARATOR}\n\n${commentStr}`;
  }

  // gray-matter stringify adds the frontmatter delimiters
  const result = matter.stringify(`\n${body}\n`, frontmatter);
  // Unknown keys go after the known ones, before the closing delimiter.
  const extra = serializeExtra(issue.extra);
  if (!extra) return result;
  const end = result.indexOf('\n---\n', 3);
  return `${result.slice(0, end)}\n${extra}${result.slice(end)}`;
}

const SEPARATOR = '---';

function isSeparatorLine(line: string): boolean {
  return line.trim() === SEPARATOR;
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

/**
 * Index of the line before `index` that is not blank, or -1.
 */
function prevNonBlank(lines: string[], index: number): number {
  let i = index - 1;
  while (i >= 0 && isBlank(lines[i] ?? '')) {
    i--;
  }
  return i;
}

/**
 * Apply `transform` to every description line that, outside code fences,
 * directly follows a `---` line (ignoring blank lines). Only those positions
 * can be confused with the description/comments separator.
 */
function transformAfterRules(
  description: string,
  transform: (line: string) => string,
): string {
  const lines = splitLines(description);
  const { kinds } = scanFences(lines);
  return lines
    .map((line, i) => {
      if (kinds[i] !== 'text') {
        return line;
      }
      const prev = prevNonBlank(lines, i);
      return prev >= 0 && isSeparatorLine(lines[prev] ?? '')
        ? transform(line)
        : line;
    })
    .join('\n');
}

/**
 * Escape a description so it can never contain the separator sequence
 * (`---`, blank lines, comment header). A header-like line right after a
 * horizontal rule gets a backslash prefix (`\### a — b`); everything else,
 * including ordinary horizontal rules and headings, is written verbatim.
 */
function escapeDescription(description: string): string {
  return transformAfterRules(description, escapeCommentHeaderLine);
}

/** Inverse of {@link escapeDescription}. */
function unescapeDescription(description: string): string {
  return transformAfterRules(description, unescapeCommentHeaderLine);
}

/**
 * Find the description/comments separator: the first `---` line outside a
 * code fence whose next non-blank line is a comment header. Returns -1 if
 * there is none (the whole content is description).
 */
function findSeparator(lines: string[]): number {
  const { kinds } = scanFences(lines);
  for (let i = 0; i < lines.length; i++) {
    if (kinds[i] !== 'text' || !isSeparatorLine(lines[i] ?? '')) {
      continue;
    }
    let next = i + 1;
    while (next < lines.length && isBlank(lines[next] ?? '')) {
      next++;
    }
    if (COMMENT_HEADER_RE.test(lines[next] ?? '')) {
      return i;
    }
  }
  return -1;
}

/**
 * Split the content (after frontmatter) into description and comments
 * section. The comments section, when present, always starts with a comment
 * header, so no content between the separator and the first comment is lost.
 */
function splitContent(content: string): {
  description: string;
  commentsSection: string;
} {
  const lines = splitLines(content);
  const separatorIndex = findSeparator(lines);

  if (separatorIndex === -1) {
    return {
      description: unescapeDescription(lines.join('\n').trim()),
      commentsSection: '',
    };
  }

  return {
    description: unescapeDescription(
      lines.slice(0, separatorIndex).join('\n').trim(),
    ),
    commentsSection: lines
      .slice(separatorIndex + 1)
      .join('\n')
      .trim(),
  };
}

/**
 * Remove the top-level `updated:` key from the YAML frontmatter of an issue
 * file, leaving everything else (including any `updated:` text in the body)
 * untouched. Returns null if the content has no frontmatter block.
 */
function stripFrontmatterUpdated(markdown: string): string | null {
  const lines = splitLines(markdown);
  if (lines[0]?.trim() !== '---') {
    return null;
  }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) {
    return null;
  }
  const frontmatter = lines
    .slice(1, end)
    .filter((l) => !/^updated\s*:/.test(l));
  return [lines[0], ...frontmatter, ...lines.slice(end)].join('\n');
}

/**
 * True if two issue file contents are identical except for the frontmatter
 * `updated:` timestamp. Only the top-level frontmatter key counts — an
 * `updated:` line in the description or comments is a real change.
 */
export function differsOnlyInUpdated(before: string, after: string): boolean {
  if (before === after) {
    return true;
  }
  const a = stripFrontmatterUpdated(before);
  const b = stripFrontmatterUpdated(after);
  return a !== null && b !== null && a === b;
}
