import { describe, expect, test } from 'bun:test';
import { issueLinks } from './links.fixture.ts';
import {
  edgeOf,
  homeOf,
  type IssueLink,
  isSafeUrl,
  issueLinkError,
  LinkGraph,
  legacyLinks,
  linkFor,
  linkFromUrl,
  linkKey,
  linkLabel,
  linkUrl,
  parseLinkRequest,
  parseLinks,
  replacedEdges,
} from './links.ts';

/** Regression tests for #127: the `links` field. */

describe('parseLinks', () => {
  test('reads issue links (numeric-string IDs), URLs and PRs; drops junk and duplicates', () => {
    expect(
      parseLinks([
        { type: 'issue', relationship: 'blockedBy', id: '3' },
        { type: 'issue', relationship: 'blockedBy', id: 3 },
        { type: 'url', url: 'https://x.dev', title: 'Spec' },
        { type: 'github-pr', repo: 'o/r', number: 7 },
        'junk',
        { no: 'type' },
      ]),
    ).toEqual([
      { type: 'issue', relationship: 'blockedBy', id: 3 },
      { type: 'url', url: 'https://x.dev', title: 'Spec' },
      { type: 'github-pr', repo: 'o/r', number: 7 },
    ]);
  });

  test('keeps unknown types and malformed links as they are', () => {
    const links = [
      { type: 'jira', key: 'ABC-1' },
      { type: 'issue', relationship: 'likes', id: 2 },
    ];
    expect(parseLinks(links)).toEqual(links);
  });

  test('legacyLinks reads parent / blockedBy / duplicateOf (version 1)', () => {
    expect(
      legacyLinks({ parent: '2', blockedBy: [5, 3, 'x', 3], duplicateOf: 9 }),
    ).toEqual(issueLinks({ parent: 2, blockedBy: [3, 5], duplicateOf: 9 }));
    expect(legacyLinks({ blockedBy: 4 })).toEqual(issueLinks({ blockedBy: 4 }));
    expect(legacyLinks({})).toEqual([]);
  });
});

describe('URLs', () => {
  test('a GitHub PR URL becomes a github-pr link; others a url link', () => {
    expect(linkFromUrl(' https://github.com/o/r/pull/12/files ')).toEqual({
      type: 'url',
      url: 'https://github.com/o/r/pull/12/files',
    });
    expect(linkFromUrl('https://github.com/o/r/pull/12')).toEqual({
      type: 'github-pr',
      repo: 'o/r',
      number: 12,
    });
    expect(linkFromUrl('https://x.dev/a', 'Spec')).toEqual({
      type: 'url',
      url: 'https://x.dev/a',
      title: 'Spec',
    });
  });

  test('linkUrl, linkLabel, linkKey', () => {
    const pr = { type: 'github-pr', repo: 'o/r', number: 12 } as const;
    expect(linkUrl(pr)).toBe('https://github.com/o/r/pull/12');
    expect(linkLabel(pr)).toBe('o/r#12');
    expect(linkLabel({ type: 'url', url: 'https://x.dev' })).toBe(
      'https://x.dev',
    );
    expect(linkKey({ type: 'url', url: 'u', title: 'a' })).toBe(
      linkKey({ type: 'url', url: 'u', title: 'b' }),
    );
  });

  test('isSafeUrl allows http, https and mailto only', () => {
    expect(isSafeUrl('https://x.dev')).toBe(true);
    expect(isSafeUrl('mailto:a@b.c')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('not a url')).toBe(false);
  });
});

describe('parseLinkRequest', () => {
  test('link: checks each link', () => {
    expect(
      parseLinkRequest(
        {
          links: [
            { type: 'issue', relationship: 'parent', id: '#4' },
            { type: 'url', url: 'ssh://git@host/repo', title: ' Repo ' },
          ],
        },
        'link',
      ),
    ).toEqual({
      links: [
        { type: 'issue', relationship: 'parent', id: 4 },
        { type: 'url', url: 'ssh://git@host/repo', title: 'Repo' },
      ],
    });
    expect(
      parseLinkRequest(
        {
          links: [
            { type: 'issue', relationship: 'likes', id: 1 },
            { type: 'issue', relationship: 'parent' },
            { type: 'url', url: 'nope' },
            { type: 'github-pr', repo: 'x', number: 1 },
            { type: 'jira' },
          ],
        },
        'link',
      ),
    ).toEqual({
      errors: [
        'Invalid relationship "likes": must be one of blockedBy, blocks, parent, child, duplicateOf, duplicatedBy, related',
        'Invalid issue link: id must be an issue ID',
        'Invalid URL "nope": must be an absolute URL',
        'Invalid GitHub PR link: repo must be owner/name',
        'Invalid link type "jira": must be issue, url or github-pr',
      ],
    });
    expect(parseLinkRequest({ links: [] }, 'link')).toEqual({
      errors: ['links must be a non-empty list of links'],
    });
    expect(parseLinkRequest(null, 'link')).toEqual({
      errors: ['Request body must be a JSON object'],
    });
  });

  test('unlink: an issue link may leave out the ID; others are keys', () => {
    expect(
      parseLinkRequest(
        {
          links: [
            { type: 'issue', relationship: 'parent' },
            { type: 'url', url: 'https://x.dev' },
            { type: 'jira', key: 'A-1' },
          ],
        },
        'unlink',
      ),
    ).toEqual({
      links: [
        { type: 'issue', relationship: 'parent' },
        { key: 'url:https://x.dev' },
        { key: linkKey({ type: 'jira', key: 'A-1' }) },
      ],
    });
  });
});

describe('LinkGraph', () => {
  const link = (relationship: IssueLink['relationship'], id: number) =>
    ({ type: 'issue', relationship, id }) as const;

  test('each relationship and its inverse are the same edge', () => {
    for (const [a, b] of [
      ['blockedBy', 'blocks'],
      ['parent', 'child'],
      ['duplicateOf', 'duplicatedBy'],
      ['related', 'related'],
    ] as const) {
      expect(edgeOf(5, link(a, 3))).toEqual(edgeOf(3, link(b, 5)));
      expect(linkFor(5, edgeOf(5, link(a, 3)))).toEqual(link(a, 3));
      expect(linkFor(3, edgeOf(5, link(a, 3)))).toEqual(link(b, 5));
    }
  });

  test('derives both sides, without duplicates or self-links', () => {
    const graph = new LinkGraph([
      { id: 1, links: issueLinks({ blocks: 2, related: 3 }) },
      { id: 2, links: issueLinks({ blockedBy: 1, parent: 3, related: 2 }) },
      { id: 3, links: issueLinks({ child: 2, duplicateOf: 4 }) },
      { id: 4 },
    ]);
    expect(graph.edges).toHaveLength(4);
    expect(graph.blockers(2)).toEqual([1]);
    expect(graph.blocked(1)).toEqual([2]);
    expect(graph.parents(2)).toEqual([3]);
    expect(graph.children(3)).toEqual([2]);
    expect(graph.originals(3)).toEqual([4]);
    expect(graph.duplicates(4)).toEqual([3]);
    expect(graph.related(3)).toEqual([1]);
    expect(graph.related(2)).toEqual([]);
  });

  test('homeOf: the blocked issue, the sub-issue, the duplicate, the higher ID', () => {
    for (const [relationship, home, stored] of [
      ['blocks', 3, 'blockedBy'],
      ['blockedBy', 5, 'blockedBy'],
      ['child', 3, 'parent'],
      ['parent', 5, 'parent'],
      ['duplicatedBy', 3, 'duplicateOf'],
      ['duplicateOf', 5, 'duplicateOf'],
      ['related', 5, 'related'],
    ] as const) {
      const edge = edgeOf(5, link(relationship, 3));
      expect([relationship, homeOf(edge)]).toEqual([relationship, home]);
      expect(linkFor(home, edge).relationship).toBe(stored);
    }
  });

  test('a new parent or original replaces the old one', () => {
    const graph = new LinkGraph([
      { id: 1, links: issueLinks({ parent: 2, duplicateOf: 3 }) },
    ]);
    expect(replacedEdges(graph, edgeOf(1, link('parent', 4)))).toEqual([
      edgeOf(1, link('parent', 2)),
    ]);
    expect(replacedEdges(graph, edgeOf(5, link('child', 1)))).toEqual([
      edgeOf(1, link('parent', 2)),
    ]);
    expect(replacedEdges(graph, edgeOf(1, link('duplicateOf', 4)))).toEqual([
      edgeOf(1, link('duplicateOf', 3)),
    ]);
    expect(replacedEdges(graph, edgeOf(1, link('blockedBy', 4)))).toEqual([]);
  });
});

describe('issueLinkError', () => {
  const graph = new LinkGraph([
    { id: 2, links: issueLinks({ blockedBy: 1 }) },
    { id: 3, links: issueLinks({ blockedBy: 2, parent: 4 }) },
    { id: 5, links: issueLinks({ duplicateOf: 6 }) },
  ]);
  const exists = (id: number) => id < 10;
  const error = (
    id: number,
    relationship: IssueLink['relationship'],
    to: number,
  ) =>
    issueLinkError(id, { type: 'issue', relationship, id: to }, graph, exists);

  test('accepts valid links', () => {
    expect(error(3, 'blockedBy', 1)).toBeNull();
    expect(error(1, 'related', 3)).toBeNull();
    expect(error(2, 'related', 1)).toBeNull();
  });

  test('rejects itself and missing issues', () => {
    expect(error(1, 'blockedBy', 1)).toBe("Issue #1 can't be linked to itself");
    expect(error(1, 'parent', 99)).toBe('Issue #99 not found (parent of #1)');
  });

  test('rejects cycles, whichever side the link is written from', () => {
    expect(error(1, 'blockedBy', 3)).toBe(
      '#1 blocked by #3 would create a cycle (#3 blocks #1 blocks #2 blocks #3)',
    );
    expect(error(3, 'blocks', 1)).toBe(
      '#3 blocks #1 would create a cycle (#3 blocks #1 blocks #2 blocks #3)',
    );
    expect(error(4, 'parent', 3)).toBe(
      '#4 with parent #3 would create a cycle (#3 is parent of #4 is parent of #3)',
    );
    expect(error(6, 'duplicateOf', 5)).toBe(
      '#6 duplicate of #5 would create a cycle (#6 duplicates #5 duplicates #6)',
    );
  });
});
