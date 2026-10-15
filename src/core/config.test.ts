import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import {
  chooseDefaultBranch,
  createDefaultConfig,
  ensureLabelColors,
  findAssigneeByEmail,
  generateLabelColor,
  hslToHex,
  parseConfig,
  resolveAssigneeName,
  serializeConfig,
  validateConfig,
} from './config.ts';
import {
  isClosedStatus as isClosed,
  priorityNames,
  statusNames,
} from './workflow.ts';

const VALID_YAML = `
version: 1
nextId: 5
statuses:
  - backlog
  - todo
  - in_progress
  - done
  - cancelled
labels:
  bug: "#e05d5d"
  feature: "#58a6e0"
assignees:
  - name: Alice
    email: alice@example.com
  - name: Bob
    email: bob@example.com
priorities:
  - urgent
  - high
  - medium
  - low
  - none
defaultStatus: backlog
defaultPriority: medium
git:
  autoCommit: true
  autoPush: false
  commitPrefix: "issue:"
  defaultBranch: main
`;

describe('parseConfig', () => {
  test('parses valid YAML into Config', () => {
    const config = parseConfig(VALID_YAML);
    expect(config.version).toBe(1);
    expect(config.nextId).toBe(5);
    expect(statusNames(config)).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'done',
      'cancelled',
    ]);
    expect(config.labels.bug).toBe('#e05d5d');
    expect(config.labels.feature).toBe('#58a6e0');
    expect(config.assignees).toEqual([
      { name: 'Alice', email: 'alice@example.com' },
      { name: 'Bob', email: 'bob@example.com' },
    ]);
    expect(config.defaultStatus).toBe('backlog');
    expect(config.defaultPriority).toBe('medium');
    expect(config.git.autoCommit).toBe(true);
    expect(config.git.autoPush).toBe(false);
    expect(config.git.commitPrefix).toBe('issue:');
    expect(config.git.defaultBranch).toBe('main');
  });

  test('throws on missing required fields', () => {
    expect(() => parseConfig('version: 1')).toThrow();
  });

  test('throws on invalid status values', () => {
    const yaml = `
version: 1
nextId: 1
statuses:
  - backlog
  - Invalid Status
  - done
labels: {}
priorities:
  - medium
defaultStatus: backlog
defaultPriority: medium
git:
  autoCommit: true
  autoPush: false
  commitPrefix: "issue:"
  defaultBranch: main
`;
    expect(() => parseConfig(yaml)).toThrow(
      'statuses[1]: invalid name "Invalid Status"',
    );
  });

  test('uses defaults for missing git section', () => {
    const yaml = `
version: 1
nextId: 1
statuses:
  - backlog
  - todo
  - in_progress
  - done
  - cancelled
labels: {}
priorities:
  - urgent
  - high
  - medium
  - low
  - none
defaultStatus: backlog
defaultPriority: medium
`;
    const config = parseConfig(yaml);
    expect(config.git.autoCommit).toBe(true);
    expect(config.git.autoPush).toBe(false);
    expect(config.git.commitPrefix).toBe('issue:');
    expect(config.git.defaultBranch).toBe('main');
  });

  test('auto-assigns colors to labels when migrating from old array format', () => {
    const yaml = `
version: 1
nextId: 1
statuses:
  - backlog
  - todo
  - in_progress
  - done
  - cancelled
labels:
  - bug
  - feature
priorities:
  - urgent
  - high
  - medium
  - low
  - none
defaultStatus: backlog
defaultPriority: medium
`;
    const config = parseConfig(yaml);
    expect(config.labels.bug).toBeDefined();
    expect(config.labels.feature).toBeDefined();
    expect(config.labels.bug).toMatch(/^#[0-9a-f]{6}$/);
    expect(config.labels.feature).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('preserves existing colors when migrating old format with labelColors', () => {
    const yaml = `
version: 1
nextId: 1
statuses:
  - backlog
  - todo
  - in_progress
  - done
  - cancelled
labels:
  - bug
  - feature
  - docs
labelColors:
  bug: "#ff0000"
  feature: "#00ff00"
priorities:
  - urgent
  - high
  - medium
  - low
  - none
defaultStatus: backlog
defaultPriority: medium
`;
    const config = parseConfig(yaml);
    expect(config.labels.bug).toBe('#ff0000');
    expect(config.labels.feature).toBe('#00ff00');
    expect(config.labels.docs).toBeDefined();
    expect(config.labels.docs).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('parseConfig YAML safety', () => {
  /** VALID_YAML with `line` appended at the top level. */
  const withLine = (line: string) => `${VALID_YAML}${line}\n`;

  /** Recursively collect the `typeof` of every value in a parsed config. */
  function valueTypes(value: unknown, out = new Set<string>()): Set<string> {
    out.add(
      value === null
        ? 'null'
        : value instanceof RegExp
          ? 'regexp'
          : value instanceof Date
            ? 'date'
            : typeof value,
    );
    if (typeof value === 'object' && value !== null) {
      for (const v of Object.values(value)) valueTypes(v, out);
    }
    return out;
  }

  test.each([
    ['!!js/function', `evil: !!js/function 'function () { return 1; }'`],
    ['!!js/function in a known field', `defaultBranch: !!js/function 'f'`],
    ['!!js/regexp', 'evil: !!js/regexp /abc/gi'],
    ['!!js/undefined', "evil: !!js/undefined ''"],
    ['!!binary', 'evil: !!binary aGVsbG8='],
    ['!!set', 'evil: !!set { a: null }'],
    ['!!timestamp', 'evil: !!timestamp 2026-03-28'],
  ])('rejects %s and never yields a JS object', (_name, line) => {
    let config: unknown;
    try {
      config = parseConfig(withLine(line));
    } catch {
      return;
    }
    // If it ever parses, it must be plain data only.
    const types = valueTypes(config);
    expect(types.has('function')).toBe(false);
    expect(types.has('regexp')).toBe(false);
    expect(types.has('date')).toBe(false);
    expect(types.has('undefined')).toBe(false);
    throw new Error(`expected ${line} to be rejected`);
  });

  test('keeps timestamp-like values as strings', () => {
    const yaml = VALID_YAML.replace(
      'defaultBranch: main',
      'defaultBranch: 2026-03-28',
    ).replace('commitPrefix: "issue:"', 'commitPrefix: 2026-03-28T12:00:00Z');
    const config = parseConfig(yaml);
    expect(config.git.defaultBranch).toBe('2026-03-28');
    expect(config.git.commitPrefix).toBe('2026-03-28T12:00:00Z');
  });

  test('does not pollute Object.prototype via __proto__ keys', () => {
    const config = parseConfig(withLine('__proto__:\n  polluted: true'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(config)).toBe(Object.prototype);
  });
});

describe('serializeConfig', () => {
  test('output format is stable (single-quoted special strings)', () => {
    const config = parseConfig(VALID_YAML);
    config.git.defaultBranch = '2026-03-28';
    expect(serializeConfig(config)).toBe(
      [
        'version: 1',
        'nextId: 5',
        'statuses:',
        '  - backlog',
        '  - todo',
        '  - in_progress',
        '  - done',
        '  - cancelled',
        'labels:',
        "  bug: '#e05d5d'",
        "  feature: '#58a6e0'",
        'assignees:',
        '  - name: Alice',
        '    email: alice@example.com',
        '  - name: Bob',
        '    email: bob@example.com',
        'priorities:',
        '  - urgent',
        '  - high',
        '  - medium',
        '  - low',
        '  - none',
        'defaultStatus: backlog',
        'defaultPriority: medium',
        'git:',
        '  autoCommit: true',
        '  autoPush: false',
        "  commitPrefix: 'issue:'",
        "  defaultBranch: '2026-03-28'",
        '',
      ].join('\n'),
    );
  });

  test("this repo's config.yaml round-trips byte-for-byte", async () => {
    const path = fileURLToPath(
      new URL('../../.issues/config.yaml', import.meta.url),
    );
    const raw = await Bun.file(path).text();
    expect(serializeConfig(parseConfig(raw))).toBe(raw);
  });

  test('serializes Config to YAML', () => {
    const config = createDefaultConfig();
    const yaml = serializeConfig(config);
    expect(yaml).toContain('version: 1');
    expect(yaml).not.toContain('nextId');
    expect(yaml).toContain('defaultStatus: backlog');
    expect(yaml).toContain('defaultPriority: medium');
    expect(yaml).toContain('autoCommit: true');
    expect(yaml).toContain('labels:');
  });
});

describe('createDefaultConfig', () => {
  test('returns a valid config with default values', () => {
    const config = createDefaultConfig();
    expect(config.version).toBe(1);
    expect(config.nextId).toBeUndefined();
    expect(statusNames(config)).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'done',
      'cancelled',
    ]);
    expect(Object.keys(config.labels)).toEqual([
      'bug',
      'feature',
      'enhancement',
      'docs',
      'chore',
    ]);
    expect(config.assignees).toEqual([]);
    expect(priorityNames(config)).toEqual([
      'urgent',
      'high',
      'medium',
      'low',
      'none',
    ]);
    expect(config.defaultStatus).toBe('backlog');
    expect(config.defaultPriority).toBe('medium');
    expect(config.git).toEqual({
      autoCommit: true,
      autoPush: false,
      commitPrefix: 'issue:',
      defaultBranch: 'main',
    });
    expect(validateConfig(config)).toBe(true);
  });

  test('defaultBranch overrides git.defaultBranch', () => {
    const config = createDefaultConfig({ defaultBranch: 'master' });
    expect(config.git.defaultBranch).toBe('master');
    expect(config.git.commitPrefix).toBe('issue:');
    expect(createDefaultConfig({}).git.defaultBranch).toBe('main');
  });

  test('assigns colors to all default labels', () => {
    const config = createDefaultConfig();
    for (const [_label, color] of Object.entries(config.labels)) {
      expect(color).toBeDefined();
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('chooseDefaultBranch', () => {
  test('prefers origin/HEAD, then the current branch, then init.defaultBranch', () => {
    expect(
      chooseDefaultBranch({
        originHead: 'develop',
        current: 'feature',
        initDefault: 'trunk',
      }),
    ).toBe('develop');
    expect(
      chooseDefaultBranch({ current: 'master', initDefault: 'trunk' }),
    ).toBe('master');
    expect(
      chooseDefaultBranch({
        originHead: null,
        current: null,
        initDefault: 'trunk',
      }),
    ).toBe('trunk');
  });

  test('falls back to main; blank hints are ignored', () => {
    expect(chooseDefaultBranch({})).toBe('main');
    expect(
      chooseDefaultBranch({ originHead: ' ', current: '', initDefault: '' }),
    ).toBe('main');
  });
});

describe('validateConfig', () => {
  test('returns true for valid config', () => {
    expect(validateConfig(createDefaultConfig())).toBe(true);
  });

  test('returns false for non-object', () => {
    expect(validateConfig('not an object')).toBe(false);
    expect(validateConfig(null)).toBe(false);
    expect(validateConfig(42)).toBe(false);
  });

  test('returns false for missing fields', () => {
    expect(validateConfig({ version: 1 })).toBe(false);
  });

  test('legacy nextId is optional but must be a number if present', () => {
    const config = createDefaultConfig();
    expect('nextId' in config).toBe(false);
    expect(validateConfig({ ...config, nextId: 7 })).toBe(true);
    expect(validateConfig({ ...config, nextId: '7' })).toBe(false);
    expect(parseConfig(VALID_YAML.replace('nextId: 5\n', '')).nextId).toBe(
      undefined,
    );
  });

  test('custom status/priority names are valid (#57); malformed ones are not', () => {
    const config = createDefaultConfig();
    expect(
      validateConfig({ ...config, statuses: ['backlog', 'review', 'done'] }),
    ).toBe(true);
    expect(
      validateConfig({ ...config, statuses: ['backlog', 'In review', 'done'] }),
    ).toBe(false);
    expect(validateConfig({ ...config, priorities: ['p0', 'medium'] })).toBe(
      true,
    );
    // defaultPriority must be configured
    expect(validateConfig({ ...config, priorities: ['p0', 'p1'] })).toBe(false);
  });

  test('returns false for invalid labels (non-object)', () => {
    const config = {
      ...createDefaultConfig(),
      labels: 'not-an-object',
    };
    expect(validateConfig(config)).toBe(false);
  });

  test('returns false for labels with non-string values', () => {
    const config = {
      ...createDefaultConfig(),
      labels: { bug: 123 },
    };
    expect(validateConfig(config)).toBe(false);
  });
});

describe('generateLabelColor', () => {
  test('returns a valid hex color', () => {
    const color = generateLabelColor();
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('generates different colors on subsequent calls', () => {
    const colors = new Set<string>();
    for (let i = 0; i < 20; i++) {
      colors.add(generateLabelColor());
    }
    // Should have at least a few distinct colors (probabilistic but very safe)
    expect(colors.size).toBeGreaterThan(5);
  });
});

describe('hslToHex', () => {
  test('converts known values correctly', () => {
    // Pure red: hsl(0, 100%, 50%)
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    // Pure green: hsl(120, 100%, 50%)
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    // Pure blue: hsl(240, 100%, 50%)
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
    // White: hsl(0, 0%, 100%)
    expect(hslToHex(0, 0, 100)).toBe('#ffffff');
    // Black: hsl(0, 0%, 0%)
    expect(hslToHex(0, 0, 0)).toBe('#000000');
  });
});

describe('ensureLabelColors', () => {
  test('assigns colors from palette to new labels', () => {
    const result = ensureLabelColors(['bug', 'feature'], {});
    expect(result.bug).toBeDefined();
    expect(result.feature).toBeDefined();
    expect(result.bug).not.toBe(result.feature);
  });

  test('preserves existing colors', () => {
    const existing = { bug: '#ff0000' };
    const result = ensureLabelColors(['bug', 'feature'], existing);
    expect(result.bug).toBe('#ff0000');
    expect(result.feature).toBeDefined();
  });

  test('does not overwrite existing colors', () => {
    const existing = { bug: '#custom1', feature: '#custom2' };
    const result = ensureLabelColors(['bug', 'feature'], existing);
    expect(result.bug).toBe('#custom1');
    expect(result.feature).toBe('#custom2');
  });
});

describe('assignees', () => {
  test('defaults assignees to empty array when missing from YAML', () => {
    const yaml = `
version: 1
nextId: 1
statuses:
  - backlog
  - todo
  - in_progress
  - done
  - cancelled
labels: {}
priorities:
  - urgent
  - high
  - medium
  - low
  - none
defaultStatus: backlog
defaultPriority: medium
`;
    const config = parseConfig(yaml);
    expect(config.assignees).toEqual([]);
  });

  test('parses assignees from YAML', () => {
    const config = parseConfig(VALID_YAML);
    expect(config.assignees).toHaveLength(2);
    expect(config.assignees[0]).toEqual({
      name: 'Alice',
      email: 'alice@example.com',
    });
  });

  test('serializes and re-parses assignees', () => {
    const config = createDefaultConfig();
    config.assignees = [{ name: 'Test User', email: 'test@example.com' }];
    const yaml = serializeConfig(config);
    const parsed = parseConfig(yaml);
    expect(parsed.assignees).toEqual([
      { name: 'Test User', email: 'test@example.com' },
    ]);
  });

  test('validates assignees must be array of objects with name and email', () => {
    const config = createDefaultConfig();

    // Invalid: non-array
    expect(validateConfig({ ...config, assignees: 'not-array' })).toBe(false);

    // Invalid: array of non-objects
    expect(validateConfig({ ...config, assignees: ['string'] })).toBe(false);

    // Invalid: missing email
    expect(validateConfig({ ...config, assignees: [{ name: 'Test' }] })).toBe(
      false,
    );

    // Invalid: missing name
    expect(
      validateConfig({
        ...config,
        assignees: [{ email: 'test@example.com' }],
      }),
    ).toBe(false);

    // Valid
    expect(
      validateConfig({
        ...config,
        assignees: [{ name: 'Test', email: 'test@example.com' }],
      }),
    ).toBe(true);
  });
});

describe('findAssigneeByEmail', () => {
  const assignees = [
    { name: 'Alice', email: 'alice@example.com' },
    { name: 'Bob', email: 'bob@example.com' },
  ];

  test('finds assignee by email (case-insensitive)', () => {
    expect(findAssigneeByEmail(assignees, 'Alice@Example.COM')).toEqual({
      name: 'Alice',
      email: 'alice@example.com',
    });
  });

  test('returns undefined for unknown email', () => {
    expect(
      findAssigneeByEmail(assignees, 'unknown@example.com'),
    ).toBeUndefined();
  });
});

describe('resolveAssigneeName', () => {
  const assignees = [{ name: 'Alice', email: 'alice@example.com' }];

  test('returns name when email matches', () => {
    expect(resolveAssigneeName(assignees, 'alice@example.com')).toBe('Alice');
  });

  test('returns raw value when no match', () => {
    expect(resolveAssigneeName(assignees, 'unknown@example.com')).toBe(
      'unknown@example.com',
    );
  });

  test('returns empty string for empty input', () => {
    expect(resolveAssigneeName(assignees, '')).toBe('');
  });
});

/** Regression tests for #57: status/priority definitions in config.yaml. */
describe('status and priority definitions (#57)', () => {
  const base = (statuses: string, extra = '') => `version: 1
statuses:
${statuses}
labels: {}
priorities:
  - high
  - low
defaultStatus: open
defaultPriority: low
${extra}`;

  /** The error message parseConfig throws for `yaml` ('' if it parses). */
  function errorOf(yaml: string): string {
    try {
      parseConfig(yaml);
      return '';
    } catch (err) {
      return (err as Error).message;
    }
  }

  test('legacy plain names migrate on read: done/cancelled closed, others open', () => {
    const config = parseConfig(
      VALID_YAML.replace('  - todo\n', '  - review\n'),
    );
    expect(config.statuses).toEqual([
      { name: 'backlog', closed: false },
      { name: 'review', closed: false },
      { name: 'in_progress', closed: false },
      { name: 'done', closed: true },
      { name: 'cancelled', closed: true },
    ]);
    expect(config.priorities[0]).toEqual({ name: 'urgent' });
  });

  test('parses definitions (label, color, closed) and plain names mixed', () => {
    const config = parseConfig(
      base(
        `  - open
  - name: shipped
    label: Shipped!
    color: '#4dba6f'
    closed: true
  - name: done`,
      ).replace(
        '  - high\n',
        "  - name: high\n    label: Hot\n    color: '#f00'\n",
      ),
    );
    expect(config.statuses).toEqual([
      { name: 'open', closed: false },
      { name: 'shipped', label: 'Shipped!', color: '#4dba6f', closed: true },
      { name: 'done', closed: true },
    ]);
    expect(config.priorities).toEqual([
      { name: 'high', label: 'Hot', color: '#f00' },
      { name: 'low' },
    ]);
  });

  test('serializes compactly: plain names unless a definition needs more', () => {
    const yaml = base(
      `  - open
  - name: review
  - name: shipped
    color: '#4dba6f'
    closed: true
  - name: dropped
    closed: true
  - name: done
    closed: true`,
      'activeStatus: review\n',
    );
    expect(serializeConfig(parseConfig(yaml))).toBe(
      [
        'version: 1',
        'statuses:',
        '  - open',
        '  - review',
        '  - name: shipped',
        "    color: '#4dba6f'",
        '    closed: true',
        '  - name: dropped',
        '    closed: true',
        '  - done',
        'labels: {}',
        'priorities:',
        '  - high',
        '  - low',
        'defaultStatus: open',
        'defaultPriority: low',
        'activeStatus: review',
        'git:',
        '  autoCommit: true',
        '  autoPush: false',
        "  commitPrefix: 'issue:'",
        '  defaultBranch: main',
        'assignees: []',
        '',
      ].join('\n'),
    );
  });

  test('a definition overriding the legacy closed rule is kept as a definition', () => {
    const config = parseConfig(
      base(`  - open
  - name: done
    closed: false
  - name: closed
    closed: true`),
    );
    expect(isClosed(config, 'done')).toBe(false);
    const out = serializeConfig(config);
    expect(out).toContain('  - name: done\n    closed: false\n');
    expect(parseConfig(out)).toEqual(config);
  });

  test('every status and priority is validated with a clear message', () => {
    const cases: [string, string][] = [
      [base('  - open'), 'statuses: at least one must be closed'],
      [
        base('  - done', '').replace(
          'defaultStatus: open',
          'defaultStatus: done',
        ),
        'statuses: at least one must be open',
      ],
      [
        base('  - open\n  - done').replace(
          'defaultStatus: open',
          'defaultStatus: done',
        ),
        'defaultStatus "done" must be an open status',
      ],
      [
        base('  - open\n  - done').replace(
          'defaultStatus: open',
          'defaultStatus: todo',
        ),
        'defaultStatus "todo" is not a configured status (open, done)',
      ],
      [
        base('  - open\n  - done\n  - open'),
        'statuses[2]: duplicate name "open"',
      ],
      [base('  - open\n  - done\n  - all'), 'statuses[2]: "all" is reserved'],
      [base('  - open\n  - In Review\n  - done'), 'statuses[1]: invalid name'],
      [
        base('  - open\n  - name: done\n    color: red'),
        'statuses[1]: color must be a hex color',
      ],
      [
        base('  - open\n  - name: done\n    close: true'),
        'statuses[1]: unknown key "close"',
      ],
      [
        base('  - open\n  - name: done\n    closed: yes'),
        'statuses[1]: closed must be true or false',
      ],
      [
        base('  - open\n  - done', 'activeStatus: done\n'),
        'activeStatus "done" must be an open status',
      ],
      [
        base('  - open\n  - done', 'activeStatus: doing\n'),
        'activeStatus "doing" is not a configured status',
      ],
      [
        base('  - open\n  - done', 'unclaimStatus: done\n'),
        'unclaimStatus "done" must be an open status',
      ],
      [
        base('  - open\n  - done', 'activeStatus: open\nunclaimStatus: open\n'),
        'unclaimStatus must differ from activeStatus',
      ],
      [
        base('  - open\n  - done', 'closeStatus: open\n'),
        'closeStatus "open" must be a closed status',
      ],
      [
        base('  - open\n  - done', 'cancelStatus: cancelled\n'),
        'cancelStatus "cancelled" is not a configured status',
      ],
      [
        base('  - open\n  - done').replace('  - low\n', ''),
        'defaultPriority "low" is not a configured priority (high)',
      ],
      [
        base('  - open\n  - done').replace('  - high\n  - low\n', '  []\n'),
        'priorities must not be empty',
      ],
    ];
    for (const [yaml, message] of cases) {
      expect(errorOf(yaml)).toContain(message);
    }
    // ...and a valid one parses.
    expect(errorOf(base('  - open\n  - done'))).toBe('');
  });

  test('implicit defaults (in_progress, todo, done, cancelled) need not exist', () => {
    // Older configs could list any subset of the built-in statuses.
    expect(errorOf(base('  - open\n  - done'))).toBe('');
  });
});
