import yaml from 'js-yaml';
import type { Config, GitConfig } from './types.ts';

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
 * Pre-defined palette of pleasant, distinguishable colors that work
 * well on both light and dark backgrounds. We cycle through these
 * before falling back to random generation.
 */
const COLOR_PALETTE: readonly string[] = [
  '#e05d5d', // red
  '#58a6e0', // blue
  '#4dba6f', // green
  '#d4a843', // amber
  '#b065d6', // purple
  '#e07843', // orange
  '#49b5ab', // teal
  '#d65ba0', // pink
  '#7c8ae0', // indigo
  '#6db54d', // lime
];

/**
 * Generate a random pleasant HSL color as a hex string.
 * Uses constrained saturation/lightness for readability on dark/light backgrounds.
 */
export function generateLabelColor(): string {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 55 + Math.floor(Math.random() * 20); // 55-74%
  const lightness = 50 + Math.floor(Math.random() * 10); // 50-59%
  return hslToHex(hue, saturation, lightness);
}

/**
 * Convert HSL values to a hex color string.
 */
export function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);

  function f(n: number): string {
    const k = (n + h / 30) % 12;
    const color = lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  }

  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Assign colors to any labels that don't yet have one.
 * Uses the pre-defined palette first, then random colors.
 */
export function ensureLabelColors(
  labels: string[],
  existing: Record<string, string>,
): Record<string, string> {
  const result = { ...existing };
  const usedColors = new Set(Object.values(result));
  let paletteIndex = 0;

  for (const label of labels) {
    if (result[label]) continue;

    // Try to find an unused palette color
    let assigned = false;
    while (paletteIndex < COLOR_PALETTE.length) {
      const color = COLOR_PALETTE[paletteIndex] as string;
      paletteIndex++;
      if (!usedColors.has(color)) {
        result[label] = color;
        usedColors.add(color);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      // Fall back to random color
      let color = generateLabelColor();
      let attempts = 0;
      while (usedColors.has(color) && attempts < 10) {
        color = generateLabelColor();
        attempts++;
      }
      result[label] = color;
      usedColors.add(color);
    }
  }

  return result;
}

/**
 * Create a default Config with sensible defaults.
 */
export function createDefaultConfig(): Config {
  const labels = ['bug', 'feature', 'enhancement', 'docs', 'chore'];
  return {
    version: 1,
    nextId: 1,
    statuses: ['backlog', 'todo', 'in_progress', 'done', 'cancelled'],
    labels,
    labelColors: ensureLabelColors(labels, {}),
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

  // Validate labelColors is a plain object with string values
  if (typeof obj.labelColors !== 'object' || obj.labelColors === null) {
    return false;
  }
  if (Array.isArray(obj.labelColors)) return false;
  for (const v of Object.values(obj.labelColors as Record<string, unknown>)) {
    if (typeof v !== 'string') return false;
  }

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

  // Apply labelColors defaults if missing, ensuring all labels have colors
  const labels = (raw.labels as string[]) ?? [];
  const existingColors = (
    typeof raw.labelColors === 'object' &&
    raw.labelColors !== null &&
    !Array.isArray(raw.labelColors)
      ? raw.labelColors
      : {}
  ) as Record<string, string>;
  raw.labelColors = ensureLabelColors(labels, existingColors);

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
