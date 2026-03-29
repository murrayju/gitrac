import yaml from 'js-yaml';
import type { Config, GitConfig, Priority, Status } from './types.ts';

const VALID_STATUSES: readonly string[] = [
  'backlog',
  'todo',
  'in_progress',
  'done',
  'cancelled',
];
const VALID_PRIORITIES: readonly string[] = [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
];

const DEFAULT_GIT: GitConfig = {
  autoCommit: true,
  autoPush: false,
  commitPrefix: 'issue:',
  defaultBranch: 'main',
};

/**
 * Create a default Config with sensible defaults.
 */
export function createDefaultConfig(): Config {
  return {
    version: 1,
    nextId: 1,
    statuses: ['backlog', 'todo', 'in_progress', 'done', 'cancelled'],
    labels: ['bug', 'feature', 'enhancement', 'docs', 'chore'],
    priorities: ['urgent', 'high', 'medium', 'low', 'none'],
    defaultStatus: 'backlog',
    defaultPriority: 'medium',
    git: { ...DEFAULT_GIT },
  };
}

/**
 * Type guard to validate that an unknown value is a valid Config.
 */
export function validateConfig(value: unknown): value is Config {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.version !== 'number') return false;
  if (typeof obj.nextId !== 'number') return false;
  if (!Array.isArray(obj.statuses)) return false;
  if (!Array.isArray(obj.labels)) return false;
  if (!Array.isArray(obj.priorities)) return false;
  if (typeof obj.defaultStatus !== 'string') return false;
  if (typeof obj.defaultPriority !== 'string') return false;

  // Validate all statuses are valid
  for (const s of obj.statuses) {
    if (!VALID_STATUSES.includes(s as string)) return false;
  }

  // Validate all priorities are valid
  for (const p of obj.priorities) {
    if (!VALID_PRIORITIES.includes(p as string)) return false;
  }

  // Validate defaultStatus is in the statuses list
  if (!VALID_STATUSES.includes(obj.defaultStatus as string)) return false;

  // Validate defaultPriority is in the priorities list
  if (!VALID_PRIORITIES.includes(obj.defaultPriority as string)) return false;

  // Validate git section if present
  if (obj.git !== undefined) {
    if (typeof obj.git !== 'object' || obj.git === null) return false;
    const git = obj.git as Record<string, unknown>;
    if (typeof git.autoCommit !== 'boolean') return false;
    if (typeof git.autoPush !== 'boolean') return false;
    if (typeof git.commitPrefix !== 'string') return false;
    if (typeof git.defaultBranch !== 'string') return false;
  }

  return true;
}

/**
 * Parse a YAML string into a Config, validating and applying defaults.
 */
export function parseConfig(yamlStr: string): Config {
  const raw = yaml.load(yamlStr) as Record<string, unknown>;

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Config must be a YAML object');
  }

  // Apply git defaults if missing
  if (!raw.git) {
    raw.git = { ...DEFAULT_GIT };
  } else {
    const gitRaw = raw.git as Record<string, unknown>;
    raw.git = {
      autoCommit: gitRaw.autoCommit ?? DEFAULT_GIT.autoCommit,
      autoPush: gitRaw.autoPush ?? DEFAULT_GIT.autoPush,
      commitPrefix: gitRaw.commitPrefix ?? DEFAULT_GIT.commitPrefix,
      defaultBranch: gitRaw.defaultBranch ?? DEFAULT_GIT.defaultBranch,
    };
  }

  if (!validateConfig(raw)) {
    throw new Error('Invalid config: validation failed');
  }

  return raw;
}

/**
 * Serialize a Config to a YAML string.
 */
export function serializeConfig(config: Config): string {
  return yaml.dump(config, {
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false,
  });
}
