import { describe, expect, test } from 'bun:test';
import {
  createDefaultConfig,
  parseConfig,
  serializeConfig,
} from '../core/config.ts';
import { parseIssue, serializeIssue } from '../core/issue.ts';
import type {
  Comment,
  Config,
  Issue,
  IssueFrontmatter,
} from '../core/types.ts';
import {
  mergeComments,
  mergeConfigFiles,
  mergeIssueFiles,
  mergeIssueFrontmatter,
  resolveIssueConflict,
} from './conflict.ts';

function makeFrontmatter(
  overrides: Partial<IssueFrontmatter> = {},
): IssueFrontmatter {
  return {
    id: 1,
    title: 'Test Issue',
    status: 'backlog',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2025-01-01T00:00:00Z',
    createdBy: 'tester',
    updated: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('mergeIssueFrontmatter', () => {
  test('returns ours when nothing changed', () => {
    const base = makeFrontmatter();
    const ours = makeFrontmatter();
    const theirs = makeFrontmatter();
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result).toEqual(ours);
  });

  test('takes theirs change when ours unchanged', () => {
    const base = makeFrontmatter();
    const ours = makeFrontmatter();
    const theirs = makeFrontmatter({ status: 'in_progress' });
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result.status).toBe('in_progress');
  });

  test('takes ours change when theirs unchanged', () => {
    const base = makeFrontmatter();
    const ours = makeFrontmatter({ priority: 'high' });
    const theirs = makeFrontmatter();
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result.priority).toBe('high');
  });

  test('ours wins when both changed same field', () => {
    const base = makeFrontmatter();
    const ours = makeFrontmatter({ status: 'done' });
    const theirs = makeFrontmatter({ status: 'in_progress' });
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result.status).toBe('done');
  });

  test('merges different fields from both sides', () => {
    const base = makeFrontmatter();
    const ours = makeFrontmatter({ priority: 'high' });
    const theirs = makeFrontmatter({ status: 'in_progress' });
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result.priority).toBe('high');
    expect(result.status).toBe('in_progress');
  });

  test('merges labels as a set (additions from both sides)', () => {
    const base = makeFrontmatter({ labels: ['bug'] });
    const ours = makeFrontmatter({ labels: ['bug', 'feature'] });
    const theirs = makeFrontmatter({ labels: ['bug', 'docs'] });
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result.labels).toEqual(['bug', 'feature', 'docs']);
  });

  test('a label removed on one side is dropped', () => {
    const base = makeFrontmatter({ labels: ['bug', 'ui'] });
    const ours = makeFrontmatter({ labels: ['bug', 'ui', 'feature'] });
    const theirs = makeFrontmatter({ labels: ['ui'] });
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result.labels).toEqual(['ui', 'feature']);
  });

  test('updated is the later of the two, not ours', () => {
    const base = makeFrontmatter();
    const ours = makeFrontmatter({
      priority: 'high',
      updated: '2025-01-02T00:00:00Z',
    });
    const theirs = makeFrontmatter({
      status: 'todo',
      updated: '2025-01-03T00:00:00Z',
    });
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result.updated).toBe('2025-01-03T00:00:00Z');
    expect(result.priority).toBe('high');
    expect(result.status).toBe('todo');
    // ...regardless of which side is "ours".
    expect(mergeIssueFrontmatter(theirs, ours, base).updated).toBe(
      '2025-01-03T00:00:00Z',
    );
  });

  test('both changed a field: the later-updated side wins', () => {
    const base = makeFrontmatter();
    const ours = makeFrontmatter({
      status: 'done',
      updated: '2025-01-02T00:00:00Z',
    });
    const theirs = makeFrontmatter({
      status: 'in_progress',
      updated: '2025-01-03T00:00:00Z',
    });
    expect(mergeIssueFrontmatter(ours, theirs, base).status).toBe(
      'in_progress',
    );
    expect(mergeIssueFrontmatter(theirs, ours, base).status).toBe(
      'in_progress',
    );
  });

  test('without a base (add/add), differing fields go to the newer side', () => {
    const ours = makeFrontmatter({ title: 'A', labels: ['bug'] });
    const theirs = makeFrontmatter({
      title: 'B',
      labels: ['docs'],
      updated: '2025-02-01T00:00:00Z',
    });
    const result = mergeIssueFrontmatter(ours, theirs, null);
    expect(result.title).toBe('B');
    expect(result.labels).toEqual(['bug', 'docs']);
  });

  test('handles assignee change', () => {
    const base = makeFrontmatter({ assignee: '' });
    const ours = makeFrontmatter({ assignee: '' });
    const theirs = makeFrontmatter({ assignee: 'alice' });
    const result = mergeIssueFrontmatter(ours, theirs, base);
    expect(result.assignee).toBe('alice');
  });
});

describe('mergeComments', () => {
  test('returns empty array for no comments', () => {
    expect(mergeComments([], [])).toEqual([]);
  });

  test('union of disjoint comments', () => {
    const ours: Comment[] = [
      { author: 'alice', timestamp: '2025-01-01T00:00:00Z', body: 'hello' },
    ];
    const theirs: Comment[] = [
      { author: 'bob', timestamp: '2025-01-02T00:00:00Z', body: 'world' },
    ];
    const result = mergeComments(ours, theirs);
    expect(result).toHaveLength(2);
    expect(result[0]?.author).toBe('alice');
    expect(result[1]?.author).toBe('bob');
  });

  test('deduplicates by author+timestamp', () => {
    const comment: Comment = {
      author: 'alice',
      timestamp: '2025-01-01T00:00:00Z',
      body: 'hello',
    };
    const result = mergeComments([comment], [comment]);
    expect(result).toHaveLength(1);
  });

  test('sorts by timestamp', () => {
    const ours: Comment[] = [
      { author: 'alice', timestamp: '2025-01-03T00:00:00Z', body: 'third' },
    ];
    const theirs: Comment[] = [
      { author: 'bob', timestamp: '2025-01-01T00:00:00Z', body: 'first' },
      { author: 'carol', timestamp: '2025-01-02T00:00:00Z', body: 'second' },
    ];
    const result = mergeComments(ours, theirs);
    expect(result).toHaveLength(3);
    expect(result[0]?.author).toBe('bob');
    expect(result[1]?.author).toBe('carol');
    expect(result[2]?.author).toBe('alice');
  });

  test('keeps ours body when duplicate has different body', () => {
    const ours: Comment[] = [
      {
        author: 'alice',
        timestamp: '2025-01-01T00:00:00Z',
        body: 'ours version',
      },
    ];
    const theirs: Comment[] = [
      {
        author: 'alice',
        timestamp: '2025-01-01T00:00:00Z',
        body: 'theirs version',
      },
    ];
    const result = mergeComments(ours, theirs);
    expect(result).toHaveLength(1);
    expect(result[0]?.body).toBe('ours version');
  });

  const a: Comment = {
    author: 'alice',
    timestamp: '2025-01-01T00:00:00Z',
    body: 'one',
  };
  const b: Comment = {
    author: 'bob',
    timestamp: '2025-01-02T00:00:00Z',
    body: 'two',
  };

  test('with a base, a comment deleted on one side stays deleted', () => {
    expect(mergeComments([a], [a, b], [a, b])).toEqual([a]);
    expect(mergeComments([a, b], [b], [a, b])).toEqual([b]);
  });

  test('with a base, an edit on either side is taken', () => {
    const edited = { ...b, body: 'two (edited)' };
    expect(mergeComments([a, b], [a, edited], [a, b])).toEqual([a, edited]);
    expect(mergeComments([a, edited], [a, b], [a, b])).toEqual([a, edited]);
  });

  test('a comment deleted on one side but edited on the other is kept', () => {
    const edited = { ...b, body: 'two (edited)' };
    expect(mergeComments([a], [a, edited], [a, b])).toEqual([a, edited]);
  });
});

describe('resolveIssueConflict', () => {
  const baseContent = [
    '---',
    'id: 1',
    'title: Test Issue',
    'status: backlog',
    'priority: medium',
    'assignee: ""',
    'labels: []',
    'created: "2025-01-01T00:00:00Z"',
    'createdBy: tester',
    'updated: "2025-01-01T00:00:00Z"',
    '---',
    '',
    'Base description.',
    '',
  ].join('\n');

  test('merges when only frontmatter changed', async () => {
    const oursContent = baseContent.replace(
      'status: backlog',
      'status: in_progress',
    );
    const theirsContent = baseContent.replace(
      'priority: medium',
      'priority: high',
    );
    const result = await resolveIssueConflict(
      oursContent,
      theirsContent,
      baseContent,
    );
    expect(result).not.toBeNull();
    expect(result).toContain('in_progress');
    expect(result).toContain('high');
  });

  test('returns null when descriptions conflict', async () => {
    const oursContent = baseContent.replace(
      'Base description.',
      'Our new description.',
    );
    const theirsContent = baseContent.replace(
      'Base description.',
      'Their new description.',
    );
    const result = await resolveIssueConflict(
      oursContent,
      theirsContent,
      baseContent,
    );
    expect(result).toBeNull();
  });

  test('merges when only one side changed description', async () => {
    const oursContent = baseContent.replace(
      'Base description.',
      'Updated description.',
    );
    const theirsContent = baseContent;
    const result = await resolveIssueConflict(
      oursContent,
      theirsContent,
      baseContent,
    );
    expect(result).not.toBeNull();
    expect(result).toContain('Updated description.');
  });

  test('merges comments from both sides', async () => {
    const oursContent = `${baseContent.trimEnd()}\n\n---\n\n### alice \u2014 2025-01-02T00:00:00Z\n\nhello\n`;
    const theirsContent = `${baseContent.trimEnd()}\n\n---\n\n### bob \u2014 2025-01-03T00:00:00Z\n\nworld\n`;
    const result = await resolveIssueConflict(
      oursContent,
      theirsContent,
      baseContent,
    );
    expect(result).not.toBeNull();
    expect(result).toContain('alice');
    expect(result).toContain('bob');
  });
});

function issueFile(overrides: Partial<Issue> = {}): string {
  return serializeIssue({
    ...makeFrontmatter(),
    description: 'line one\nline two\nline three',
    comments: [],
    ...overrides,
  });
}

describe('mergeIssueFiles', () => {
  const base = issueFile();

  test('merges frontmatter, comments and one-sided description edits', async () => {
    const ours = issueFile({
      priority: 'high',
      updated: '2025-01-02T00:00:00Z',
      comments: [
        { author: 'alice', timestamp: '2025-01-02T00:00:00Z', body: 'ours' },
      ],
    });
    const theirs = issueFile({
      status: 'todo',
      labels: ['bug'],
      description: 'line one\nline two (theirs)\nline three',
      updated: '2025-01-03T00:00:00Z',
      comments: [
        { author: 'bob', timestamp: '2025-01-03T00:00:00Z', body: 'theirs' },
      ],
    });
    const result = await mergeIssueFiles(base, ours, theirs);
    expect(result.conflict).toBe(false);
    const merged = parseIssue(result.content);
    expect(merged).toMatchObject({
      priority: 'high',
      status: 'todo',
      labels: ['bug'],
      description: 'line one\nline two (theirs)\nline three',
      updated: '2025-01-03T00:00:00Z',
    });
    expect(merged.comments.map((c) => c.body)).toEqual(['ours', 'theirs']);
  });

  test('both changed the description: uses the text merger', async () => {
    const ours = issueFile({
      description: 'line one (ours)\nline two\nline three',
    });
    const theirs = issueFile({
      description: 'line one\nline two\nline three (theirs)',
    });
    const calls: string[][] = [];
    const result = await mergeIssueFiles(
      base,
      ours,
      theirs,
      async (b, o, t) => {
        calls.push([b, o, t]);
        return { text: 'MERGED\n', conflict: false };
      },
    );
    expect(calls).toEqual([
      [
        'line one\nline two\nline three\n',
        'line one (ours)\nline two\nline three\n',
        'line one\nline two\nline three (theirs)\n',
      ],
    ]);
    expect(result.conflict).toBe(false);
    expect(parseIssue(result.content).description).toBe('MERGED');
  });

  test('a conflicting description keeps the markers and flags the conflict', async () => {
    const ours = issueFile({ description: 'ours', priority: 'high' });
    const theirs = issueFile({ description: 'theirs' });
    const result = await mergeIssueFiles(base, ours, theirs, async () => ({
      text: '<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n',
      conflict: true,
    }));
    expect(result.conflict).toBe(true);
    expect(result.content).toContain('priority: high');
    expect(result.content).toContain(
      '<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs',
    );
  });

  test('returns a side verbatim when only the other one changed', async () => {
    const ours = issueFile({ priority: 'high' });
    expect((await mergeIssueFiles(base, ours, base)).content).toBe(ours);
    expect((await mergeIssueFiles(base, base, ours)).content).toBe(ours);
  });

  test('add/add (empty base) merges both versions', async () => {
    const ours = issueFile({
      comments: [{ author: 'a', timestamp: '2025-01-02T00:00:00Z', body: 'x' }],
    });
    const theirs = issueFile({
      comments: [{ author: 'b', timestamp: '2025-01-03T00:00:00Z', body: 'y' }],
    });
    const result = await mergeIssueFiles('', ours, theirs);
    expect(result.conflict).toBe(false);
    expect(parseIssue(result.content).comments).toHaveLength(2);
  });

  test('throws on unparseable input instead of guessing', async () => {
    const ours = issueFile({ priority: 'high' });
    const theirs = issueFile({ status: 'todo' });
    await expect(mergeIssueFiles(base, 'not an issue', theirs)).rejects.toThrow(
      'missing frontmatter',
    );
    await expect(
      mergeIssueFiles(base, ours, `${theirs}\n<<<<<<< HEAD\nx\n`),
    ).rejects.toThrow('conflict markers');
    await expect(
      mergeIssueFiles(base, ours, issueFile({ id: 2, status: 'todo' })),
    ).rejects.toThrow('different issue IDs');
    await expect(
      mergeIssueFiles(base, ours, theirs.replace('id: 1', 'id: nope')),
    ).rejects.toThrow('invalid id');
    await expect(
      mergeIssueFiles(
        base,
        ours,
        theirs.replace('title: Test Issue', 'title: ['),
      ),
    ).rejects.toThrow();
  });
});

/** Regression tests for #55: dependency fields in the merge driver. */
describe('merging dependency fields', () => {
  test('blockedBy merges as a set', () => {
    const base = makeFrontmatter({ blockedBy: [1, 2] });
    const ours = makeFrontmatter({
      blockedBy: [1, 2, 3],
      updated: '2025-01-03T00:00:00Z',
    });
    const theirs = makeFrontmatter({
      blockedBy: [2, 4],
      updated: '2025-01-02T00:00:00Z',
    });
    // ours added 3, theirs added 4 and removed 1.
    expect(mergeIssueFrontmatter(ours, theirs, base).blockedBy).toEqual([
      2, 3, 4,
    ]);
  });

  test('blockedBy removed on both sides is not written', () => {
    const base = makeFrontmatter({ blockedBy: [1] });
    const ours = makeFrontmatter({ labels: ['bug'] });
    const theirs = makeFrontmatter();
    const merged = mergeIssueFrontmatter(ours, theirs, base);
    expect('blockedBy' in merged).toBe(false);
  });

  test('parent is per-field (one side wins, both: newer side)', () => {
    const base = makeFrontmatter();
    const ours = makeFrontmatter({ priority: 'high' });
    const theirs = makeFrontmatter({ parent: 7 });
    expect(mergeIssueFrontmatter(ours, theirs, base).parent).toBe(7);

    const newer = makeFrontmatter({
      parent: 8,
      updated: '2025-01-05T00:00:00Z',
    });
    expect(mergeIssueFrontmatter(newer, theirs, base).parent).toBe(8);
    // Cleared on one side.
    expect(
      'parent' in
        mergeIssueFrontmatter(
          makeFrontmatter(),
          makeFrontmatter({ labels: ['x'] }),
          makeFrontmatter({ parent: 3 }),
        ),
    ).toBe(false);
  });

  test('mergeIssueFiles merges and round-trips the fields', async () => {
    const base = issueFile({ blockedBy: [1] });
    const ours = issueFile({
      blockedBy: [1, 2],
      updated: '2025-01-02T00:00:00Z',
    });
    const theirs = issueFile({
      blockedBy: [1, 3],
      parent: 9,
      updated: '2025-01-03T00:00:00Z',
    });
    const result = await mergeIssueFiles(base, ours, theirs);
    expect(result.conflict).toBe(false);
    const merged = parseIssue(result.content);
    expect(merged.blockedBy).toEqual([1, 2, 3]);
    expect(merged.parent).toBe(9);
  });
});

describe('mergeConfigFiles', () => {
  const baseConfig: Config = {
    ...createDefaultConfig(),
    labels: { bug: '#e05d5d', ui: '#58a6e0' },
    assignees: [{ name: 'Ada', email: 'ada@example.com' }],
  };
  const base = serializeConfig(baseConfig);
  const variant = (overrides: Partial<Config> & Record<string, unknown>) =>
    serializeConfig({ ...baseConfig, ...overrides } as Config);

  test('takes the max nextId', () => {
    const merged = parseConfig(
      mergeConfigFiles(
        variant({ nextId: 4 }),
        variant({ nextId: 9, defaultPriority: 'high' }),
        variant({ nextId: 7, defaultStatus: 'todo' }),
      ),
    );
    expect(merged.nextId).toBe(9);
    expect(merged.defaultPriority).toBe('high');
    expect(merged.defaultStatus).toBe('todo');
  });

  test('unions labels; ours wins color conflicts; recolors clashes', () => {
    const merged = parseConfig(
      mergeConfigFiles(
        base,
        variant({
          labels: { bug: '#111111', ui: '#58a6e0', api: '#4dba6f' },
        }),
        variant({
          labels: { bug: '#222222', ui: '#58a6e0', docs: '#4dba6f' },
        }),
      ),
    );
    expect(merged.labels.bug).toBe('#111111');
    expect(merged.labels.api).toBe('#4dba6f');
    expect(Object.keys(merged.labels)).toEqual(['bug', 'ui', 'api', 'docs']);
    expect(merged.labels.docs).toBeString();
    expect(merged.labels.docs).not.toBe('#4dba6f');
  });

  test('a color changed on one side only is taken', () => {
    const merged = parseConfig(
      mergeConfigFiles(
        base,
        variant({ labels: { ...baseConfig.labels, api: '#4dba6f' } }),
        variant({ labels: { bug: '#000000', ui: '#58a6e0' } }),
      ),
    );
    expect(merged.labels).toEqual({
      bug: '#000000',
      ui: '#58a6e0',
      api: '#4dba6f',
    });
  });

  test('unions assignees by email; removals stick', () => {
    const merged = parseConfig(
      mergeConfigFiles(
        base,
        variant({
          assignees: [
            { name: 'Ada', email: 'ada@example.com' },
            { name: 'Bob', email: 'bob@example.com' },
          ],
        }),
        variant({
          assignees: [
            { name: 'Ada', email: 'ada@example.com' },
            { name: 'Bobby', email: 'BOB@example.com' },
            { name: 'Cy', email: 'cy@example.com' },
          ],
        }),
      ),
    );
    expect(merged.assignees).toEqual([
      { name: 'Ada', email: 'ada@example.com' },
      { name: 'Bob', email: 'bob@example.com' },
      { name: 'Cy', email: 'cy@example.com' },
    ]);
    const removed = parseConfig(
      mergeConfigFiles(
        base,
        variant({ assignees: [] }),
        variant({
          assignees: [
            { name: 'Ada', email: 'ada@example.com' },
            { name: 'Cy', email: 'cy@example.com' },
          ],
        }),
      ),
    );
    expect(removed.assignees).toEqual([
      { name: 'Cy', email: 'cy@example.com' },
    ]);
  });

  test('merges git settings per key and keeps unknown keys', () => {
    const merged = parseConfig(
      mergeConfigFiles(
        base,
        variant({ git: { ...baseConfig.git, autoPush: true }, custom: 1 }),
        variant({ git: { ...baseConfig.git, commitPrefix: 'chore:' } }),
      ),
    ) as Config & Record<string, unknown>;
    expect(merged.git.autoPush).toBe(true);
    expect(merged.git.commitPrefix).toBe('chore:');
    expect(merged.custom).toBe(1);
  });

  test('throws on an invalid side', () => {
    expect(() =>
      mergeConfigFiles(base, variant({ nextId: 3 }), 'labels: [unclosed'),
    ).toThrow();
    expect(() =>
      mergeConfigFiles(base, variant({ nextId: 3 }), 'version: 1\n'),
    ).toThrow();
    expect(() =>
      mergeConfigFiles(
        base,
        variant({ nextId: 3 }),
        `${base}<<<<<<< ours\n=======\n>>>>>>> theirs\n`,
      ),
    ).toThrow('conflict markers');
  });
});
