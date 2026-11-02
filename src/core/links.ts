/**
 * Issue links (pure; no I/O). An issue's `links` frontmatter field is a list
 * of objects. Each link has a `type`, and the type sets the other fields:
 *
 * - `issue`: `{ type: issue, relationship, id }`, a link to another gitrac
 *   issue (see {@link ISSUE_RELATIONSHIPS}).
 * - `url`: `{ type: url, url, title? }`, any URL.
 * - `github-pr`: `{ type: github-pr, repo, number }`, a GitHub pull request
 *   (`repo` is `owner/name`).
 *
 * A link of another type, or a known type with a bad shape, is kept as it
 * is (a newer gitrac can know more types), but gitrac does not use it.
 */

/**
 * What the linked issue is to this issue, read as "this issue <relationship>
 * #id": `blockedBy` (this issue can't start until #id is closed), `blocks`,
 * `parent` (#id is the parent of this issue), `child` (#id is a sub-issue of
 * this issue), `duplicateOf` (this issue is a duplicate of #id),
 * `duplicatedBy` (#id is a duplicate of this issue), `related`.
 */
export const ISSUE_RELATIONSHIPS = [
  'blockedBy',
  'blocks',
  'parent',
  'child',
  'duplicateOf',
  'duplicatedBy',
  'related',
] as const;

export type IssueRelationship = (typeof ISSUE_RELATIONSHIPS)[number];

export interface IssueLink {
  type: 'issue';
  relationship: IssueRelationship;
  id: number;
}

export interface UrlLink {
  type: 'url';
  url: string;
  title?: string;
}

export interface GithubPrLink {
  type: 'github-pr';
  /** `owner/name`. */
  repo: string;
  number: number;
}

/** A link of a type gitrac doesn't know, or with a bad shape: kept as is. */
export interface OtherLink {
  type: string;
  [key: string]: unknown;
}

export type Link = IssueLink | UrlLink | GithubPrLink | OtherLink;

const RELATIONSHIP_SET: ReadonlySet<string> = new Set(ISSUE_RELATIONSHIPS);
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PR_URL_RE =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)\/?(?:[?#].*)?$/;

export function isIssueRelationship(
  value: unknown,
): value is IssueRelationship {
  return typeof value === 'string' && RELATIONSHIP_SET.has(value);
}

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

export function isIssueLink(link: Link): link is IssueLink {
  return (
    link.type === 'issue' &&
    isIssueRelationship(link.relationship) &&
    isPositiveInteger(link.id)
  );
}

export function isUrlLink(link: Link): link is UrlLink {
  return (
    link.type === 'url' &&
    typeof link.url === 'string' &&
    link.url !== '' &&
    (link.title === undefined || typeof link.title === 'string')
  );
}

export function isGithubPrLink(link: Link): link is GithubPrLink {
  return (
    link.type === 'github-pr' &&
    typeof link.repo === 'string' &&
    REPO_RE.test(link.repo) &&
    isPositiveInteger(link.number)
  );
}

/** One issue ID: a number or a `"7"` / `"#7"` string; else undefined. */
export function toIssueId(value: unknown): number | undefined {
  if (isPositiveInteger(value)) return value;
  if (typeof value === 'string' && /^\s*#?\d+\s*$/.test(value)) {
    const id = Number.parseInt(value.trim().replace(/^#/, ''), 10);
    return id > 0 ? id : undefined;
  }
  return undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Read one stored link. An issue link's `id` may be a numeric string (it
 * becomes a number). An entry that is not an object with a string `type` is
 * dropped (null); other unknown or malformed links are kept as they are.
 */
function readLink(value: unknown): Link | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'issue') {
    const id = toIssueId(value.id);
    if (id !== undefined && isIssueRelationship(value.relationship)) {
      const { type, relationship, id: _id, ...rest } = value;
      return { type: 'issue', relationship, id, ...rest };
    }
  }
  return { ...value } as OtherLink;
}

/**
 * A stable key per link: two links with the same key are the same link
 * (used to drop duplicates and to merge).
 */
export function linkKey(link: Link): string {
  if (isIssueLink(link)) return `issue:${link.relationship}:${link.id}`;
  if (isUrlLink(link)) return `url:${link.url}`;
  if (isGithubPrLink(link)) return `github-pr:${link.repo}#${link.number}`;
  return `other:${stableJson(link)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** `links` without duplicates (by {@link linkKey}), first one kept, in order. */
export function uniqueLinks(links: readonly Link[]): Link[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = linkKey(link);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Parse a stored `links` value (see {@link readLink}). */
export function parseLinks(value: unknown): Link[] {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value];
  return uniqueLinks(
    items.map(readLink).filter((link): link is Link => link !== null),
  );
}

/**
 * The links of the frontmatter fields that `links` replaced (config version
 * 1): `parent: id`, `blockedBy: [ids]` and `duplicateOf: id`. Bad values
 * are dropped.
 */
export function legacyLinks(fields: {
  parent?: unknown;
  blockedBy?: unknown;
  duplicateOf?: unknown;
}): IssueLink[] {
  const links: IssueLink[] = [];
  const parent = toIssueId(fields.parent);
  if (parent !== undefined) {
    links.push({ type: 'issue', relationship: 'parent', id: parent });
  }
  const blockers =
    fields.blockedBy === undefined || fields.blockedBy === null
      ? []
      : Array.isArray(fields.blockedBy)
        ? fields.blockedBy
        : [fields.blockedBy];
  const ids = [
    ...new Set(blockers.map(toIssueId).filter((id) => id !== undefined)),
  ].sort((a, b) => a - b);
  for (const id of ids) {
    links.push({ type: 'issue', relationship: 'blockedBy', id });
  }
  const duplicateOf = toIssueId(fields.duplicateOf);
  if (duplicateOf !== undefined) {
    links.push({ type: 'issue', relationship: 'duplicateOf', id: duplicateOf });
  }
  return links;
}

/** The issue links of `links`. */
export function issueLinksOf(links: readonly Link[] | undefined): IssueLink[] {
  return (links ?? []).filter(isIssueLink);
}

/**
 * A link for `url`: a GitHub pull request URL becomes a `github-pr` link,
 * any other URL a `url` link.
 */
export function linkFromUrl(url: string, title?: string): Link {
  const trimmed = url.trim();
  const pr = PR_URL_RE.exec(trimmed);
  if (pr && title === undefined) {
    return {
      type: 'github-pr',
      repo: pr[1] as string,
      number: Number(pr[2]),
    };
  }
  return { type: 'url', url: trimmed, ...(title ? { title } : {}) };
}

/** The URL a link opens, or null (issue links and unknown types). */
export function linkUrl(link: Link): string | null {
  if (isUrlLink(link)) return link.url;
  if (isGithubPrLink(link)) {
    return `https://github.com/${link.repo}/pull/${link.number}`;
  }
  return null;
}

/** A short text for a link: `#7`, the URL title or URL, `owner/name#12`. */
export function linkLabel(link: Link): string {
  if (isIssueLink(link)) return `#${link.id}`;
  if (isUrlLink(link)) return link.title?.trim() || link.url;
  if (isGithubPrLink(link)) return `${link.repo}#${link.number}`;
  return `${link.type} link`;
}

/** Whether `url` is safe to open from the web UI (http, https or mailto). */
export function isSafeUrl(url: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Check one link given as input (CLI, API): an issue link needs a known
 * relationship and an issue ID (`7` or `"#7"`); a URL link an absolute URL
 * on one line and an optional one-line title; a GitHub PR link an
 * `owner/name` repo and a PR number. Returns the link (with `id` as a
 * number) or an error message.
 */
export function parseLinkInput(value: unknown): Link | string {
  if (!isRecord(value)) return 'A link must be an object';
  const { type } = value;
  if (type === 'issue') {
    if (!isIssueRelationship(value.relationship)) {
      return `Invalid relationship ${JSON.stringify(value.relationship)}: must be one of ${ISSUE_RELATIONSHIPS.join(', ')}`;
    }
    const id = toIssueId(value.id);
    if (id === undefined) return 'Invalid issue link: id must be an issue ID';
    return { type, relationship: value.relationship, id };
  }
  if (type === 'url') {
    const { url, title } = value;
    if (typeof url !== 'string' || /\s/.test(url.trim()) || !canParseUrl(url)) {
      return `Invalid URL ${JSON.stringify(url)}: must be an absolute URL`;
    }
    if (
      title !== undefined &&
      (typeof title !== 'string' || /[\r\n]/.test(title))
    ) {
      return 'Invalid link title: must be one line of text';
    }
    const trimmedTitle = typeof title === 'string' ? title.trim() : '';
    return {
      type,
      url: url.trim(),
      ...(trimmedTitle ? { title: trimmedTitle } : {}),
    };
  }
  if (type === 'github-pr') {
    const { repo, number } = value;
    if (typeof repo !== 'string' || !REPO_RE.test(repo)) {
      return 'Invalid GitHub PR link: repo must be owner/name';
    }
    const n = toIssueId(number);
    if (n === undefined) {
      return 'Invalid GitHub PR link: number must be a PR number';
    }
    return { type, repo, number: n };
  }
  return `Invalid link type ${JSON.stringify(type)}: must be issue, url or github-pr`;
}

function canParseUrl(url: string): boolean {
  try {
    new URL(url.trim());
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------ */
/* The relations between issues                                              */
/* ------------------------------------------------------------------------ */

/**
 * A relation between two issues, whichever issue stores it: `blocks` (`from`
 * blocks `to`), `parent` (`from` is the parent of `to`), `duplicate` (`from`
 * is a duplicate of `to`), `related` (`from` < `to`).
 */
export interface IssueEdge {
  kind: 'blocks' | 'parent' | 'duplicate' | 'related';
  from: number;
  to: number;
}

/** The edge that issue `issueId`'s link stands for. */
export function edgeOf(issueId: number, link: IssueLink): IssueEdge {
  const { id } = link;
  switch (link.relationship) {
    case 'blockedBy':
      return { kind: 'blocks', from: id, to: issueId };
    case 'blocks':
      return { kind: 'blocks', from: issueId, to: id };
    case 'parent':
      return { kind: 'parent', from: id, to: issueId };
    case 'child':
      return { kind: 'parent', from: issueId, to: id };
    case 'duplicateOf':
      return { kind: 'duplicate', from: issueId, to: id };
    case 'duplicatedBy':
      return { kind: 'duplicate', from: id, to: issueId };
    case 'related':
      return {
        kind: 'related',
        from: Math.min(issueId, id),
        to: Math.max(issueId, id),
      };
  }
}

/**
 * How issue `issueId` (one end of `edge`) stores it: e.g. `blockedBy` on the
 * blocked issue, `blocks` on the blocker.
 */
export function linkFor(issueId: number, edge: IssueEdge): IssueLink {
  const isFrom = edge.from === issueId;
  const other = isFrom ? edge.to : edge.from;
  const relationship: IssueRelationship = {
    blocks: isFrom ? 'blocks' : 'blockedBy',
    parent: isFrom ? 'child' : 'parent',
    duplicate: isFrom ? 'duplicateOf' : 'duplicatedBy',
    related: 'related',
  }[edge.kind] as IssueRelationship;
  return { type: 'issue', relationship, id: other };
}

export const edgeKey = (edge: IssueEdge): string =>
  `${edge.kind}:${edge.from}:${edge.to}`;

/**
 * Every relation between `issues`, from the links each one stores (an
 * issue only stores its own side; the other side is derived), without
 * duplicates. A link to the issue itself is ignored.
 */
export class LinkGraph {
  readonly edges: IssueEdge[];

  constructor(issues: Iterable<{ id: number; links?: readonly Link[] }>) {
    const byKey = new Map<string, IssueEdge>();
    for (const issue of issues) {
      for (const link of issueLinksOf(issue.links)) {
        if (link.id === issue.id) continue;
        const edge = edgeOf(issue.id, link);
        byKey.set(edgeKey(edge), edge);
      }
    }
    this.edges = [...byKey.values()];
  }

  has(edge: IssueEdge): boolean {
    return this.edges.some((e) => edgeKey(e) === edgeKey(edge));
  }

  /** IDs of the issues on the `to` side of `kind` edges from `id`, ascending. */
  private targets(kind: IssueEdge['kind'], id: number): number[] {
    return sortedIds(
      this.edges.filter((e) => e.kind === kind && e.from === id),
      'to',
    );
  }

  /** IDs of the issues on the `from` side of `kind` edges to `id`, ascending. */
  private sources(kind: IssueEdge['kind'], id: number): number[] {
    return sortedIds(
      this.edges.filter((e) => e.kind === kind && e.to === id),
      'from',
    );
  }

  /** The issues `id` is blocked by. */
  blockers(id: number): number[] {
    return this.sources('blocks', id);
  }

  /** The issues `id` blocks. */
  blocked(id: number): number[] {
    return this.targets('blocks', id);
  }

  /** The parents of `id` (normally one). */
  parents(id: number): number[] {
    return this.sources('parent', id);
  }

  /** The sub-issues of `id`. */
  children(id: number): number[] {
    return this.targets('parent', id);
  }

  /** The issues `id` is a duplicate of (normally one). */
  originals(id: number): number[] {
    return this.targets('duplicate', id);
  }

  /** The issues that are duplicates of `id`. */
  duplicates(id: number): number[] {
    return this.sources('duplicate', id);
  }

  /** The issues related to `id`. */
  related(id: number): number[] {
    return [
      ...new Set([
        ...this.targets('related', id),
        ...this.sources('related', id),
      ]),
    ].sort((a, b) => a - b);
  }

  /**
   * The chain of `kind` edges from `start` to `target`
   * (`[start, ..., target]`), or null if there is none.
   */
  path(
    kind: IssueEdge['kind'],
    start: number,
    target: number,
  ): number[] | null {
    const seen = new Set<number>();
    const walk = (id: number): number[] | null => {
      if (id === target) return [id];
      if (seen.has(id)) return null;
      seen.add(id);
      for (const next of this.targets(kind, id)) {
        const rest = walk(next);
        if (rest) return [id, ...rest];
      }
      return null;
    };
    return walk(start);
  }
}

function sortedIds(edges: IssueEdge[], end: 'from' | 'to'): number[] {
  return [...new Set(edges.map((e) => e[end]))].sort((a, b) => a - b);
}

/**
 * Relationships that an issue can have only one of: a parent, and the
 * issue it duplicates. Adding one replaces the old one.
 */
export function replacedEdges(graph: LinkGraph, edge: IssueEdge): IssueEdge[] {
  if (edge.kind === 'parent') {
    return graph.edges.filter(
      (e) => e.kind === 'parent' && e.to === edge.to && e.from !== edge.from,
    );
  }
  if (edge.kind === 'duplicate') {
    return graph.edges.filter(
      (e) => e.kind === 'duplicate' && e.from === edge.from && e.to !== edge.to,
    );
  }
  return [];
}

/** How a relationship reads in messages: `#5 <phrase> #7`. */
const PHRASES: Record<IssueRelationship, string> = {
  blockedBy: 'blocked by',
  blocks: 'blocks',
  parent: 'with parent',
  child: 'with sub-issue',
  duplicateOf: 'duplicate of',
  duplicatedBy: 'duplicated by',
  related: 'related to',
};

/** `blockedBy` -> `blocked by` (for messages and labels). */
export function relationshipPhrase(relationship: IssueRelationship): string {
  return PHRASES[relationship];
}

/**
 * Check a link to add to issue `id`. `graph` is every relation (with the
 * relations the link replaces already removed); `exists(id)` tells if an
 * issue exists. Returns an error message, or null: the target must be
 * another issue that exists, and a `blocks`, `parent` or `duplicate` edge
 * must not close a cycle.
 */
export function issueLinkError(
  id: number,
  link: IssueLink,
  graph: LinkGraph,
  exists: (id: number) => boolean,
): string | null {
  const phrase = relationshipPhrase(link.relationship);
  if (link.id === id) return `Issue #${id} can't be linked to itself`;
  if (!exists(link.id)) {
    return `Issue #${link.id} not found (${link.relationship} of #${id})`;
  }
  const edge = edgeOf(id, link);
  if (edge.kind === 'related') return null;
  // A cycle: the edge's target already reaches its source.
  const path = graph.path(edge.kind, edge.to, edge.from);
  if (!path) return null;
  const cycle = [edge.from, ...path]
    .map((n) => `#${n}`)
    .join(` ${CYCLE_ARROWS[edge.kind]} `);
  return `#${id} ${phrase} #${link.id} would create a cycle (${cycle})`;
}

const CYCLE_ARROWS: Record<IssueEdge['kind'], string> = {
  blocks: 'blocks',
  parent: 'is parent of',
  duplicate: 'duplicates',
  related: '',
};

/** What to remove: issue links by relationship (all of them if no `id`), others by key. */
export type LinkSelector =
  | { type: 'issue'; relationship: IssueRelationship; id?: number }
  | { key: string };

function parseSelector(value: unknown): LinkSelector | string {
  if (isRecord(value) && value.type === 'issue') {
    if (!isIssueRelationship(value.relationship)) {
      return `Invalid relationship ${JSON.stringify(value.relationship)}: must be one of ${ISSUE_RELATIONSHIPS.join(', ')}`;
    }
    if (value.id === undefined) {
      return { type: 'issue', relationship: value.relationship };
    }
    const id = toIssueId(value.id);
    if (id === undefined) return 'Invalid issue link: id must be an issue ID';
    return { type: 'issue', relationship: value.relationship, id };
  }
  if (
    isRecord(value) &&
    value.type === 'url' &&
    typeof value.url === 'string'
  ) {
    return { key: `url:${value.url.trim()}` };
  }
  if (!isRecord(value) || typeof value.type !== 'string') {
    return 'A link must be an object with a type';
  }
  const parsed = parseLinkInput(value);
  // A link of an unknown type is removed by its exact content.
  return {
    key: linkKey(typeof parsed === 'string' ? (value as Link) : parsed),
  };
}

/**
 * Parse the body of a link / unlink request, `{ links: [...] }` (a non-empty
 * list). For `link`, each entry is checked with {@link parseLinkInput}; for
 * `unlink`, an issue link may leave out `id` (to remove every link of that
 * relationship). Returns the links / selectors, or the error messages.
 */
export function parseLinkRequest(
  input: unknown,
  mode: 'link',
): { links: Link[] } | { errors: string[] };
export function parseLinkRequest(
  input: unknown,
  mode: 'unlink',
): { links: LinkSelector[] } | { errors: string[] };
export function parseLinkRequest(
  input: unknown,
  mode: 'link' | 'unlink',
): { links: (Link | LinkSelector)[] } | { errors: string[] } {
  if (!isRecord(input))
    return { errors: ['Request body must be a JSON object'] };
  const { links } = input;
  if (!Array.isArray(links) || links.length === 0) {
    return { errors: ['links must be a non-empty list of links'] };
  }
  const parse: (value: unknown) => Link | LinkSelector | string =
    mode === 'link' ? parseLinkInput : parseSelector;
  const parsed = links.map(parse);
  const errors = parsed.filter((p): p is string => typeof p === 'string');
  if (errors.length > 0) return { errors };
  return { links: parsed as (Link | LinkSelector)[] };
}

/** Whether `link` (stored on issue `issueId`) is selected by `selector`. */
export function selects(
  selector: LinkSelector,
  issueId: number,
  edge: IssueEdge,
): boolean {
  if (!('type' in selector)) return false;
  const link = linkFor(issueId, edge);
  return (
    link.relationship === selector.relationship &&
    (selector.id === undefined || selector.id === link.id)
  );
}
