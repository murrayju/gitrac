import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { GitracError } from './errors.ts';
import { scanFences } from './fences.ts';
import {
  differsOnlyInUpdated,
  parseIssue,
  parseIssueFile,
  serializeIssue,
} from './issue.ts';
import type { Comment, Issue } from './types.ts';

const FULL_ISSUE = `---
id: 1
title: Fix Login Timeout
status: in_progress
priority: high
assignee: alice
labels:
  - bug
  - urgent
created: "2024-01-15T10:00:00Z"
createdBy: bob
updated: "2024-01-15T12:00:00Z"
---

Users are experiencing timeouts when logging in during peak hours.

## Steps to Reproduce

1. Go to login page
2. Enter credentials
3. Wait 30 seconds

---

### Alice \u2014 2024-01-15T11:00:00Z

I can reproduce this. Looks like a connection pool issue.

### Bob \u2014 2024-01-15T12:00:00Z

\\## Fix Attempt

Increased pool size to 20.`;

const ISSUE_NO_COMMENTS = `---
id: 2
title: Add dark mode
status: backlog
priority: medium
assignee: ""
labels: []
created: "2024-01-16T09:00:00Z"
createdBy: alice
updated: "2024-01-16T09:00:00Z"
---

We should add a dark mode option to the UI.`;

const ISSUE_EMPTY_DESCRIPTION = `---
id: 3
title: Empty issue
status: todo
priority: low
assignee: ""
labels: []
created: "2024-01-17T09:00:00Z"
createdBy: bob
updated: "2024-01-17T09:00:00Z"
---
`;

describe('parseIssue', () => {
  test('parses a complete issue with frontmatter, description, and comments', () => {
    const issue = parseIssue(FULL_ISSUE);
    expect(issue.id).toBe(1);
    expect(issue.title).toBe('Fix Login Timeout');
    expect(issue.status).toBe('in_progress');
    expect(issue.priority).toBe('high');
    expect(issue.assignee).toBe('alice');
    expect(issue.labels).toEqual(['bug', 'urgent']);
    expect(issue.created).toBe('2024-01-15T10:00:00Z');
    expect(issue.createdBy).toBe('bob');
    expect(issue.updated).toBe('2024-01-15T12:00:00Z');
    expect(issue.description).toContain('Users are experiencing timeouts');
    expect(issue.description).toContain('## Steps to Reproduce');
    expect(issue.comments).toHaveLength(2);
    expect(issue.comments[0]?.author).toBe('Alice');
    expect(issue.comments[0]?.body).toContain('connection pool issue');
    expect(issue.comments[1]?.author).toBe('Bob');
    expect(issue.comments[1]?.body).toContain('## Fix Attempt');
  });

  test('parses an issue with no comments', () => {
    const issue = parseIssue(ISSUE_NO_COMMENTS);
    expect(issue.id).toBe(2);
    expect(issue.title).toBe('Add dark mode');
    expect(issue.comments).toEqual([]);
    expect(issue.description).toBe(
      'We should add a dark mode option to the UI.',
    );
  });

  test('parses an issue with empty description', () => {
    const issue = parseIssue(ISSUE_EMPTY_DESCRIPTION);
    expect(issue.id).toBe(3);
    expect(issue.description).toBe('');
    expect(issue.comments).toEqual([]);
  });

  test('parses an issue with headings in description (NOT escaped)', () => {
    const issue = parseIssue(FULL_ISSUE);
    // Headings in description should appear as-is
    expect(issue.description).toContain('## Steps to Reproduce');
  });

  test('parses frontmatter fields correctly', () => {
    const issue = parseIssue(FULL_ISSUE);
    expect(issue.id).toBe(1);
    expect(issue.title).toBe('Fix Login Timeout');
    expect(issue.status).toBe('in_progress');
    expect(issue.priority).toBe('high');
    expect(issue.assignee).toBe('alice');
    expect(issue.labels).toEqual(['bug', 'urgent']);
    expect(issue.created).toBe('2024-01-15T10:00:00Z');
    expect(issue.createdBy).toBe('bob');
    expect(issue.updated).toBe('2024-01-15T12:00:00Z');
  });
});

describe('parseIssue frontmatter normalization', () => {
  const UNQUOTED_DATES = `---
id: 4
title: Unquoted dates
status: todo
priority: low
assignee: alice
labels:
  - bug
created: 2026-03-28T12:00:00Z
createdBy: bob
updated: 2026-03-28T14:30:00Z
---

Body.`;

  test('keeps unquoted ISO timestamps as strings', () => {
    const issue = parseIssue(UNQUOTED_DATES);
    expect(typeof issue.created).toBe('string');
    expect(typeof issue.updated).toBe('string');
    expect(issue.created).toBe('2026-03-28T12:00:00Z');
    expect(issue.updated).toBe('2026-03-28T14:30:00Z');
    expect(issue.updated.slice(0, 10)).toBe('2026-03-28');
  });

  test('keeps unquoted date-only values and date-like titles as written', () => {
    const issue = parseIssue(
      UNQUOTED_DATES.replace('title: Unquoted dates', 'title: 2026-03-28')
        .replace('created: 2026-03-28T12:00:00Z', 'created: 2026-03-28')
        .replace('updated: 2026-03-28T14:30:00Z', 'updated: 2026-03-29'),
    );
    expect(issue.title).toBe('2026-03-28');
    expect(issue.created).toBe('2026-03-28');
    expect(issue.updated).toBe('2026-03-29');
  });

  test('unquoted dates survive a serialize/parse round-trip', () => {
    const issue = parseIssue(UNQUOTED_DATES);
    const reparsed = parseIssue(serializeIssue(issue));
    expect(reparsed.created).toBe('2026-03-28T12:00:00Z');
    expect(reparsed.updated).toBe('2026-03-28T14:30:00Z');
  });

  test('JSON output keeps string timestamps', () => {
    const json = JSON.parse(JSON.stringify(parseIssue(UNQUOTED_DATES)));
    expect(json.created).toBe('2026-03-28T12:00:00Z');
    expect(json.updated).toBe('2026-03-28T14:30:00Z');
  });

  test('coerces scalar fields to the expected types', () => {
    const issue = parseIssue(`---
id: "7"
title: 123
status: todo
priority: low
assignee: 42
labels: bug
created: "2026-03-28T12:00:00Z"
createdBy: true
updated: "2026-03-28T12:00:00Z"
---
`);
    expect(issue.id).toBe(7);
    expect(issue.title).toBe('123');
    expect(issue.assignee).toBe('42');
    expect(issue.labels).toEqual(['bug']);
    expect(issue.createdBy).toBe('true');
  });

  test('normalizes labels to an array of strings', () => {
    const issue = parseIssue(
      UNQUOTED_DATES.replace(
        'labels:\n  - bug',
        'labels:\n  - 1\n  - bug\n  -',
      ),
    );
    expect(issue.labels).toEqual(['1', 'bug']);
  });

  test('defaults missing or null fields', () => {
    const issue = parseIssue('---\nid: 9\nassignee:\nlabels:\n---\n\nBody');
    expect(issue.id).toBe(9);
    expect(issue.title).toBe('');
    expect(issue.assignee).toBe('');
    expect(issue.labels).toEqual([]);
    expect(issue.created).toBe('');
    expect(issue.updated).toBe('');
  });

  test('non-numeric id becomes NaN', () => {
    expect(parseIssue('---\nid: abc\n---\n').id).toBeNaN();
  });

  test('does not share parsed objects between calls with identical input', () => {
    const first = parseIssue(UNQUOTED_DATES);
    first.labels.push('mutated');
    const second = parseIssue(UNQUOTED_DATES);
    expect(second.labels).toEqual(['bug']);
    expect(second.labels).not.toBe(first.labels);
  });
});

describe('serializeIssue', () => {
  test('serializes an Issue back to markdown with frontmatter', () => {
    const issue = parseIssue(ISSUE_NO_COMMENTS);
    const result = serializeIssue(issue);
    expect(result).toContain('---');
    expect(result).toContain('id: 2');
    expect(result).toContain('title: Add dark mode');
    expect(result).toContain('We should add a dark mode option to the UI.');
  });

  test('round-trip: parse then serialize produces semantically equivalent output', () => {
    const issue = parseIssue(FULL_ISSUE);
    const serialized = serializeIssue(issue);
    const reparsed = parseIssue(serialized);
    expect(reparsed.id).toBe(issue.id);
    expect(reparsed.title).toBe(issue.title);
    expect(reparsed.status).toBe(issue.status);
    expect(reparsed.priority).toBe(issue.priority);
    expect(reparsed.assignee).toBe(issue.assignee);
    expect(reparsed.labels).toEqual(issue.labels);
    expect(reparsed.description).toBe(issue.description);
    expect(reparsed.comments).toHaveLength(issue.comments.length);
    for (let i = 0; i < issue.comments.length; i++) {
      expect(reparsed.comments[i]?.author).toBe(issue.comments[i]?.author);
      expect(reparsed.comments[i]?.timestamp).toBe(
        issue.comments[i]?.timestamp,
      );
      expect(reparsed.comments[i]?.body).toBe(issue.comments[i]?.body);
    }
  });

  test('issue with comments includes --- separator', () => {
    const issue = parseIssue(FULL_ISSUE);
    const serialized = serializeIssue(issue);
    // After the frontmatter closing ---, there should be description, then ---, then comments
    const afterFrontmatter = serialized.split('---').slice(2).join('---');
    // Should contain a --- separator between description and comments
    expect(afterFrontmatter).toContain('---');
  });

  test('issue with no comments has no trailing ---', () => {
    const issue = parseIssue(ISSUE_NO_COMMENTS);
    const serialized = serializeIssue(issue);
    // Should have exactly 2 --- (frontmatter open and close)
    const parts = serialized.split('---');
    // parts[0] is empty before first ---, parts[1] is frontmatter, parts[2] is rest
    expect(parts.length).toBe(3);
    // No trailing ---
    expect(serialized.trimEnd().endsWith('---')).toBe(false);
  });
});

describe('differsOnlyInUpdated', () => {
  const doc = (updated: string, body = 'Body.') =>
    `---\nid: 1\ntitle: T\nupdated: '${updated}'\n---\n\n${body}\n`;

  test('true for identical content', () => {
    expect(differsOnlyInUpdated(doc('a'), doc('a'))).toBe(true);
  });

  test('true when only the frontmatter updated: value differs', () => {
    expect(differsOnlyInUpdated(doc('a'), doc('b'))).toBe(true);
  });

  test('false when the body differs', () => {
    expect(differsOnlyInUpdated(doc('a'), doc('b', 'Other.'))).toBe(false);
  });

  test('false when an updated: line in the body differs', () => {
    expect(
      differsOnlyInUpdated(doc('a', 'updated: x'), doc('a', 'updated: y')),
    ).toBe(false);
  });

  test('false when another frontmatter field differs', () => {
    expect(
      differsOnlyInUpdated(doc('a'), doc('b').replace('title: T', 'title: U')),
    ).toBe(false);
  });

  test('false when only a nested (indented) updated: key differs', () => {
    const a = '---\nid: 1\nmeta:\n  updated: x\n---\n';
    const b = '---\nid: 1\nmeta:\n  updated: y\n---\n';
    expect(differsOnlyInUpdated(a, b)).toBe(false);
  });

  test('false for differing content without frontmatter', () => {
    expect(differsOnlyInUpdated('updated: a\n', 'updated: b\n')).toBe(false);
  });
});

const HEADER = (author: string) => `### ${author} \u2014 2024-01-01T00:00:00Z`;

function makeIssue(description: string, comments: Comment[] = []): Issue {
  return {
    id: 7,
    title: 'Tricky',
    status: 'todo',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2024-01-01T00:00:00Z',
    createdBy: 'tester',
    updated: '2024-01-01T00:00:00Z',
    description,
    comments,
  };
}

function withBody(body: string): string {
  return `---\nid: 7\ntitle: T\nstatus: todo\npriority: low\nassignee: ''\nlabels: []\ncreated: x\ncreatedBy: y\nupdated: z\n---\n\n${body}\n`;
}

describe('horizontal rules and separators', () => {
  test('horizontal rule in description does not truncate it', () => {
    const issue = parseIssue(withBody('Part A\n\n---\n\nPart B after hr'));
    expect(issue.description).toBe('Part A\n\n---\n\nPart B after hr');
    expect(issue.comments).toEqual([]);
  });

  test('description with hr survives a save', () => {
    const raw = withBody('Part A\n\n---\n\nPart B after hr');
    expect(serializeIssue(parseIssue(raw))).toContain('Part B after hr');
  });

  for (const hr of ['---', '***', '___', '- - -', '  ---  ']) {
    test(`hr ${JSON.stringify(hr)} in description and comments round-trips`, () => {
      const description = `Intro\n\n${hr}\n\nMore`;
      const comments = [
        { author: 'A', timestamp: 't1', body: `x\n\n${hr}\n\ny` },
        { author: 'B', timestamp: 't2', body: `${hr}\n\nz\n\n${hr}\n\nend` },
      ];
      const parsed = parseIssue(
        serializeIssue(makeIssue(description, comments)),
      );
      expect(parsed.description).toBe(description);
      expect(parsed.comments).toEqual(comments);
    });
  }

  test('hr followed by a header-like line in the description is escaped', () => {
    const description = `Intro\n\n---\n\n${HEADER('Fake')}\n\nmore`;
    const serialized = serializeIssue(makeIssue(description));
    expect(serialized).toContain(`\\${HEADER('Fake')}`);
    const parsed = parseIssue(serialized);
    expect(parsed.description).toBe(description);
    expect(parsed.comments).toEqual([]);

    const withComment = makeIssue(description, [
      { author: 'Real', timestamp: 't', body: 'hi' },
    ]);
    const reparsed = parseIssue(serializeIssue(withComment));
    expect(reparsed.description).toBe(description);
    expect(reparsed.comments).toEqual(withComment.comments);
  });

  test('header-like headings not after an hr are written verbatim', () => {
    const description = `Intro\n\n${HEADER('Heading')}\n\nmore`;
    expect(serializeIssue(makeIssue(description))).toContain(
      `\n${HEADER('Heading')}\n`,
    );
  });

  test('content between a --- and the first comment header is kept', () => {
    const issue = parseIssue(
      withBody(`Desc\n\n---\n\nstray text\n\n---\n\n${HEADER('A')}\n\nhi`),
    );
    expect(issue.description).toBe('Desc\n\n---\n\nstray text');
    expect(issue.comments).toHaveLength(1);
    expect(issue.comments[0]?.body).toBe('hi');
  });

  for (const [open, close] of [
    ['```', '```'],
    ['~~~', '~~~'],
    ['  ```md', '  ```'],
    ['````', '````'],
  ]) {
    test(`separator-like text inside ${open} fence stays in description`, () => {
      const description = `Example:\n\n${open}\n---\n\n${HEADER('X')}\n\nbody\n${close}\n\nAfter`;
      const issue = parseIssue(withBody(description));
      expect(issue.description).toBe(description);
      expect(issue.comments).toEqual([]);
      const comments = [{ author: 'C', timestamp: 't', body: 'c' }];
      const reparsed = parseIssue(
        serializeIssue(makeIssue(description, comments)),
      );
      expect(reparsed.description).toBe(description);
      expect(reparsed.comments).toEqual(comments);
    });
  }

  test('unclosed fence in description is closed before comments', () => {
    const comments = [{ author: 'A', timestamp: 't', body: 'kept' }];
    const parsed = parseIssue(
      serializeIssue(makeIssue('Code:\n\n~~~~\nfoo', comments)),
    );
    expect(parsed.description).toBe('Code:\n\n~~~~\nfoo\n~~~~');
    expect(parsed.comments).toEqual(comments);
  });

  test('unclosed fence without comments is left alone', () => {
    const parsed = parseIssue(serializeIssue(makeIssue('```\nfoo')));
    expect(parsed.description).toBe('```\nfoo');
  });
});

describe('CRLF line endings', () => {
  const toCrlf = (text: string) => text.replace(/\n/g, '\r\n');

  /** Parse `lf` and its CRLF form, and expect the same issue from both. */
  function expectSameAsLf(lf: string): Issue {
    const fromLf = parseIssue(lf);
    const fromCrlf = parseIssue(toCrlf(lf));
    expect(fromCrlf).toEqual(fromLf);
    expect(fromCrlf.description).not.toContain('\r');
    for (const comment of fromCrlf.comments) {
      expect(comment.body).not.toContain('\r');
    }
    return fromCrlf;
  }

  test('description and comments are split as with LF', () => {
    const issue = expectSameAsLf(FULL_ISSUE);
    expect(issue.description).toBe(
      'Users are experiencing timeouts when logging in during peak hours.\n\n## Steps to Reproduce\n\n1. Go to login page\n2. Enter credentials\n3. Wait 30 seconds',
    );
    expect(issue.comments).toEqual([
      {
        author: 'Alice',
        timestamp: '2024-01-15T11:00:00Z',
        body: 'I can reproduce this. Looks like a connection pool issue.',
      },
      {
        author: 'Bob',
        timestamp: '2024-01-15T12:00:00Z',
        body: '## Fix Attempt\n\nIncreased pool size to 20.',
      },
    ]);
  });

  test('an issue without comments or description', () => {
    expect(expectSameAsLf(ISSUE_NO_COMMENTS).description).toBe(
      'We should add a dark mode option to the UI.',
    );
    expect(expectSameAsLf(ISSUE_EMPTY_DESCRIPTION).description).toBe('');
  });

  test('horizontal rules and escaped header-like lines in the description', () => {
    const description = `Intro\n\n---\n\n${HEADER('Fake')}\n\n***\n\nmore`;
    const comments = [
      { author: 'A', timestamp: 't1', body: 'x\n\n---\n\ny' },
      { author: 'B', timestamp: 't2', body: '## heading\n\nz' },
    ];
    const serialized = serializeIssue(makeIssue(description, comments));
    expect(serialized).toContain(`\\${HEADER('Fake')}`);
    const issue = expectSameAsLf(serialized);
    expect(issue.description).toBe(description);
    expect(issue.comments).toEqual(comments);
  });

  test('code fences hide separator-like text in the description', () => {
    for (const [open, close] of [
      ['```', '```'],
      ['~~~ md', '~~~'],
      ['  ```js', '  ```'],
    ]) {
      const description = `Example:\n\n${open}\n---\n\n${HEADER('X')}\n\nbody\n${close}\n\nAfter`;
      const issue = expectSameAsLf(withBody(description));
      expect(issue.description).toBe(description);
      expect(issue.comments).toEqual([]);

      const comments = [
        {
          author: 'C',
          timestamp: 't',
          body: `${open}\n${HEADER('Y')}\n${close}`,
        },
      ];
      const reparsed = expectSameAsLf(
        serializeIssue(makeIssue(description, comments)),
      );
      expect(reparsed.description).toBe(description);
      expect(reparsed.comments).toEqual(comments);
    }
  });

  test('an unclosed fence closed before the comments', () => {
    const comments = [{ author: 'A', timestamp: 't', body: 'kept' }];
    const issue = expectSameAsLf(
      serializeIssue(makeIssue('Code:\n\n~~~~\nfoo', comments)),
    );
    expect(issue.description).toBe('Code:\n\n~~~~\nfoo\n~~~~');
    expect(issue.comments).toEqual(comments);
  });

  test('frontmatter, dependencies and unknown keys', () => {
    const raw = `---\nid: 7\ntitle: T\nstatus: todo\npriority: low\nassignee: ''\nlabels:\n  - bug\nparent: 2\nblockedBy:\n  - 3\ncreated: x\ncreatedBy: bob\nupdated: z\nestimate: 3 # days\n---\n\nDesc\n\n---\n\n${HEADER('A')}\n\nhi\n`;
    const issue = expectSameAsLf(raw);
    expect(issue.labels).toEqual(['bug']);
    expect(issue.parent).toBe(2);
    expect(issue.blockedBy).toEqual([3]);
    expect(issue.extra).toEqual({ estimate: 3 });
    expect(issue.comments).toHaveLength(1);
    // A rewrite produces LF output, the same as for the LF file.
    expect(serializeIssue(issue)).toBe(raw);
  });

  test('scanFences classifies CRLF-split lines as LF ones', () => {
    const lines = ['a', '```ts', '## code', '```', '~~~~', 'b'];
    expect(scanFences(lines.map((line) => `${line}\r`))).toEqual(
      scanFences(lines),
    );
  });
});

describe('round-trip property tests', () => {
  const FRAGMENTS = [
    '',
    '   ',
    'text',
    'a \u2014 b',
    '---',
    '--- ',
    ' ---',
    '***',
    '___',
    '- - -',
    '#',
    '# h1',
    '## h2',
    HEADER('Alice'),
    `\\${HEADER('Bob')}`,
    `\\\\${HEADER('Carol')}`,
    '\\## escaped',
    '\\\\# double',
    '```',
    '```js',
    '````',
    '~~~',
    '~~~~ md',
    '  ```',
    '    ~~~',
    '> quote',
    '- item',
    '1. one',
  ];

  // Deterministic PRNG (mulberry32) so failures are reproducible.
  function rng(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomText(next: () => number): string {
    const count = Math.floor(next() * 12);
    const lines: string[] = [];
    for (let i = 0; i < count; i++) {
      lines.push(FRAGMENTS[Math.floor(next() * FRAGMENTS.length)] ?? '');
    }
    return lines.join('\n').trim();
  }

  test('parse(serialize(issue)) preserves description and comments', () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const next = rng(seed);
      const description = randomText(next);
      const commentCount = Math.floor(next() * 4);
      const comments: Comment[] = [];
      for (let c = 0; c < commentCount; c++) {
        comments.push({
          author: `user${c}`,
          timestamp: `2024-01-0${c + 1}T00:00:00Z`,
          body: randomText(next),
        });
      }
      let expected = description;
      const { open } = scanFences(description.split('\n'));
      if (open && comments.length > 0) {
        expected = `${description}\n${open.char.repeat(open.length)}`;
      }
      const serialized = serializeIssue(makeIssue(description, comments));
      const parsed = parseIssue(serialized);
      const context = JSON.stringify({ seed, description, comments });
      expect({ context, description: parsed.description }).toEqual({
        context,
        description: expected,
      });
      expect({ context, comments: parsed.comments }).toEqual({
        context,
        comments,
      });
      // CRLF line endings parse to the same issue.
      expect({
        context,
        crlf: parseIssue(serialized.replace(/\n/g, '\r\n')),
      }).toEqual({ context, crlf: parsed });
      // Serialization is a fixed point after one round-trip.
      expect(serializeIssue(parsed)).toBe(
        serializeIssue(makeIssue(expected, comments)),
      );
    }
  });
});

describe('existing issue files in this repo', () => {
  const issuesDir = fileURLToPath(new URL('../../.issues/', import.meta.url));
  const files = ['*.md', 'closed/*.md']
    .flatMap((pattern) => [
      ...new Bun.Glob(pattern).scanSync({ cwd: issuesDir }),
    ])
    .sort();

  test('there are issue files to check', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.startsWith('closed/'))).toBe(true);
  });

  test('every issue file round-trips byte-for-byte', async () => {
    for (const file of files) {
      const raw = await Bun.file(`${issuesDir}${file}`).text();
      expect({ file, out: serializeIssue(parseIssue(raw)) }).toEqual({
        file,
        out: raw,
      });
    }
  });
});

describe('parseIssueFile', () => {
  const file = { id: 3, path: '.issues/3-x.md' };
  const valid = '---\nid: 3\ntitle: X\n---\n\nBody\n';

  function failure(content: string): GitracError {
    try {
      parseIssueFile(content, file);
    } catch (err) {
      return err as GitracError;
    }
    throw new Error('expected parseIssueFile to throw');
  }

  test('parses a well-formed file', () => {
    expect(parseIssueFile(valid, file)).toMatchObject({ id: 3, title: 'X' });
  });

  test('a file without frontmatter is invalid_issue, not #NaN', () => {
    const err = failure('just text\n');
    expect(err).toBeInstanceOf(GitracError);
    expect(err.code).toBe('invalid_issue');
    expect(err.exitCode).toBe(1);
    expect(err.message).toBe(
      'Issue file .issues/3-x.md is malformed: no YAML frontmatter. Fix or remove it.',
    );
    expect(err.details).toEqual({ id: 3, file: '.issues/3-x.md' });
  });

  test('a missing / non-numeric id, bad YAML or a mismatched id is invalid_issue', () => {
    expect(failure('---\ntitle: X\n---\n').message).toContain(
      'missing or invalid id in the frontmatter',
    );
    expect(failure('---\nid: abc\n---\n').code).toBe('invalid_issue');
    expect(failure('---\n: [\n---\n').message).toContain(
      'invalid frontmatter (',
    );
    expect(failure('---\nid: 4\ntitle: X\n---\n').message).toContain(
      "frontmatter id 4 doesn't match the file name (#3)",
    );
  });
});

/** Regression tests for #55: optional `parent` / `blockedBy` frontmatter. */
describe('dependency fields', () => {
  const BASE = `---
id: 7
title: Sub task
status: todo
priority: medium
assignee: ''
labels: []
created: '2025-01-01T00:00:00Z'
createdBy: tester
updated: '2025-01-01T00:00:00Z'
---

Body
`;

  test('are absent when not in the file, and not written', () => {
    const issue = parseIssue(BASE);
    expect('parent' in issue).toBe(false);
    expect('blockedBy' in issue).toBe(false);
    expect(serializeIssue(issue)).toBe(BASE);
  });

  test('round-trip byte-for-byte, after labels', () => {
    const raw = BASE.replace(
      'labels: []\n',
      'labels: []\nparent: 3\nblockedBy:\n  - 1\n  - 2\n',
    );
    const issue = parseIssue(raw);
    expect(issue.parent).toBe(3);
    expect(issue.blockedBy).toEqual([1, 2]);
    expect(serializeIssue(issue)).toBe(raw);
  });

  test('are coerced: scalars, numeric strings, duplicates, junk', () => {
    const raw = BASE.replace(
      'labels: []\n',
      "labels: []\nparent: '4'\nblockedBy: [5, '2', 5, x, 0, -1]\n",
    );
    const issue = parseIssue(raw);
    expect(issue.parent).toBe(4);
    expect(issue.blockedBy).toEqual([2, 5]);
    expect(
      parseIssue(BASE.replace('labels: []\n', 'labels: []\nblockedBy: 9\n'))
        .blockedBy,
    ).toEqual([9]);
    expect(
      'parent' in
        parseIssue(BASE.replace('labels: []\n', 'labels: []\nparent: nope\n')),
    ).toBe(false);
  });

  test('empty blockedBy is not written; blockedBy is written sorted', () => {
    const issue = parseIssue(BASE);
    expect(serializeIssue({ ...issue, blockedBy: [] })).toBe(BASE);
    expect(serializeIssue({ ...issue, blockedBy: [3, 1, 3] })).toContain(
      'blockedBy:\n  - 1\n  - 3\n',
    );
  });
});

/** Regression tests for #84: unknown frontmatter keys are preserved. */
describe('unknown frontmatter keys', () => {
  const KNOWN = `---
id: 7
title: Task
status: todo
priority: medium
assignee: ''
labels: []
created: '2025-01-01T00:00:00Z'
createdBy: tester
updated: '2025-01-01T00:00:00Z'
`;
  const BODY = '---\n\nBody\n';
  const EXTRA = `# planning
sprint: 2026-03-28
estimate: 3   # points
externalId: "GH-12"
meta: {source: jira, tags: [a, b]}
empty:
notes: |
  line one
  line two
'quoted key': yes
`;
  const RAW = `${KNOWN}${EXTRA}${BODY}`;

  test('round-trip byte-for-byte after the known keys', () => {
    expect(serializeIssue(parseIssue(RAW))).toBe(RAW);
  });

  test('are exposed as `extra` (parsed with the core schema), in file order', () => {
    const issue = parseIssue(RAW);
    expect(issue.extra).toEqual({
      sprint: '2026-03-28',
      estimate: 3,
      externalId: 'GH-12',
      meta: { source: 'jira', tags: ['a', 'b'] },
      empty: null,
      notes: 'line one\nline two\n',
      'quoted key': 'yes',
    });
    expect(Object.keys(issue.extra ?? {})).toEqual([
      'sprint',
      'estimate',
      'externalId',
      'meta',
      'empty',
      'notes',
      'quoted key',
    ]);
  });

  test('are absent when the file has none', () => {
    expect('extra' in parseIssue(`${KNOWN}${BODY}`)).toBe(false);
  });

  test('interleaved with known keys: moved after them, order kept', () => {
    const raw = KNOWN.replace(
      "assignee: ''\n",
      "assignee: ''\nzeta: 1\n# about alpha\nalpha: [x]\n",
    ).replace('createdBy: tester\n', 'createdBy: tester\nmid: two words\n');
    const out = serializeIssue(parseIssue(`${raw}${BODY}`));
    expect(out).toBe(
      `${KNOWN}zeta: 1\n# about alpha\nalpha: [x]\nmid: two words\n${BODY}`,
    );
    // ...and that is a fixed point.
    expect(serializeIssue(parseIssue(out))).toBe(out);
  });

  test('survive changes to known fields and copies of the issue', () => {
    const issue = parseIssue(RAW);
    issue.status = 'done';
    issue.labels = ['bug'];
    issue.parent = 3;
    issue.comments.push({ author: 'a', timestamp: '2025-01-02', body: 'hi' });
    const out = serializeIssue({ ...issue, title: 'Renamed' });
    expect(out).toContain(`updated: '2025-01-01T00:00:00Z'\n${EXTRA}---\n`);
    expect(parseIssue(out)).toMatchObject({
      title: 'Renamed',
      status: 'done',
      extra: issue.extra,
    });
  });

  test('a changed value is re-dumped; the others stay verbatim', () => {
    const issue = parseIssue(RAW);
    (issue.extra as Record<string, unknown>).estimate = 5;
    const out = serializeIssue(issue);
    expect(out).toBe(RAW.replace('estimate: 3   # points', 'estimate: 5'));
    expect(parseIssue(out).extra?.estimate).toBe(5);
  });

  test('extra without source text (built by hand or cloned) is dumped safely', () => {
    const issue = parseIssue(`${KNOWN}${BODY}`);
    const extra = { due: '2026-04-01', count: 2, list: ['a b'], nul: null };
    const out = serializeIssue({ ...issue, extra: structuredClone(extra) });
    expect(out).toBe(
      `${KNOWN}due: '2026-04-01'\ncount: 2\nlist:\n  - a b\nnul: null\n${BODY}`,
    );
    expect(parseIssue(out).extra).toEqual(extra);
  });

  test('anchors / aliases across keys fall back to dumping the values', () => {
    const raw = `${KNOWN}base: &b {x: 1}\ncopy: *b\n${BODY}`;
    const issue = parseIssue(raw);
    expect(issue.extra).toEqual({ base: { x: 1 }, copy: { x: 1 } });
    const out = serializeIssue(issue);
    expect(parseIssue(out).extra).toEqual(issue.extra);
    expect(serializeIssue(parseIssue(out))).toBe(out);
  });

  test('integer-like keys keep their file order', () => {
    const raw = `${KNOWN}zz: 1\n'10': ten\n2: two\n${BODY}`;
    expect(serializeIssue(parseIssue(raw))).toBe(raw);
  });

  test('a __proto__ key is kept as data, not as a prototype', () => {
    const raw = `${KNOWN}__proto__: {polluted: true}\n${BODY}`;
    const issue = parseIssue(raw);
    expect(Object.hasOwn(issue.extra ?? {}, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(serializeIssue(issue)).toBe(raw);
  });

  test('known keys never land in extra', () => {
    const issue = parseIssue(RAW.replace('id: 7', "id: '7'"));
    for (const key of ['id', 'title', 'labels', 'updated', 'parent']) {
      expect(Object.hasOwn(issue.extra ?? {}, key)).toBe(false);
    }
  });
});
