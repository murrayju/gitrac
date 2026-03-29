import { describe, expect, test } from 'bun:test';
import {
  createDefaultConfig,
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
    expect(config.labels).toEqual(['bug', 'feature']);
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
labels: []
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
labels: []
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
    expect(config.labels).toEqual([
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
});
