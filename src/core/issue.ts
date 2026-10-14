import matter from 'gray-matter';
import yaml from 'js-yaml';
import {
  COMMENT_HEADER_RE,
  escapeCommentHeaderLine,
  parseComments,
  serializeComments,
  unescapeCommentHeaderLine,
} from './comments.ts';
import { scanFences } from './fences.ts';
import type { Issue, IssueFrontmatter, Priority, Status } from './types.ts';

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
  const { data, content } = matter(markdown, MATTER_OPTIONS);
  const fm = (data ?? {}) as Record<string, unknown>;

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
    created: toStringField(fm.created),
    createdBy: toStringField(fm.createdBy),
    updated: toStringField(fm.updated),
    description,
    comments,
  };
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
    created: issue.created,
    createdBy: issue.createdBy,
    updated: issue.updated,
  };

  let body = escapeDescription(issue.description);

  if (issue.comments.length > 0) {
    // An unclosed fence would swallow the separator and every comment, so
    // close it before appending the comments section.
    const { open } = scanFences(body.split('\n'));
    if (open) {
      body = `${body}\n${open.char.repeat(open.length)}`;
    }
    const commentStr = serializeComments(issue.comments);
    body = `${body}\n\n${SEPARATOR}\n\n${commentStr}`;
  }

  // gray-matter stringify adds the frontmatter delimiters
  const result = matter.stringify(`\n${body}\n`, frontmatter);
  return result;
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
  const lines = description.split('\n');
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
  const lines = content.split('\n');
  const separatorIndex = findSeparator(lines);

  if (separatorIndex === -1) {
    return {
      description: unescapeDescription(content.trim()),
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
  const lines = markdown.split(/\r?\n/);
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
