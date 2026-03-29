import { describe, expect, test } from 'bun:test';
import {
  createDefaultConfig,
  ensureLabelColors,
  generateLabelColor,
  hslToHex,
  parseConfig,
  serializeConfig,
  validateConfig,
} from './config.ts';

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
    expect(config.statuses).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'done',
      'cancelled',
    ]);
    expect(config.labels.bug).toBe('#e05d5d');
    expect(config.labels.feature).toBe('#58a6e0');
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
  - invalid_status
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
    expect(() => parseConfig(yaml)).toThrow();
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

describe('serializeConfig', () => {
  test('serializes Config to YAML', () => {
    const config = createDefaultConfig();
    const yaml = serializeConfig(config);
    expect(yaml).toContain('version: 1');
    expect(yaml).toContain('nextId: 1');
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
    expect(config.nextId).toBe(1);
    expect(config.statuses).toEqual([
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
    expect(config.priorities).toEqual([
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

  test('assigns colors to all default labels', () => {
    const config = createDefaultConfig();
    for (const [_label, color] of Object.entries(config.labels)) {
      expect(color).toBeDefined();
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
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

  test('returns false for invalid status values', () => {
    const config = {
      ...createDefaultConfig(),
      statuses: ['backlog', 'invalid'],
    };
    expect(validateConfig(config)).toBe(false);
  });

  test('returns false for invalid priority values', () => {
    const config = {
      ...createDefaultConfig(),
      priorities: ['high', 'invalid'],
    };
    expect(validateConfig(config)).toBe(false);
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
