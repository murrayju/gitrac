import yaml from 'js-yaml';
import type {
  Assignee,
  Config,
  GitConfig,
  PriorityDefinition,
  StatusDefinition,
} from './types.ts';
import {
  activeStatus,
  DEFAULT_PRIORITY,
  DEFAULT_STATUS,
  defaultPriorityDefinitions,
  defaultStatusDefinitions,
  isLegacyClosed,
  unclaimStatus,
} from './workflow.ts';

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

/** The `git.defaultBranch` used when nothing better is known. */
export const FALLBACK_DEFAULT_BRANCH = DEFAULT_GIT.defaultBranch;

/** What git says about a repo's branches, for {@link chooseDefaultBranch}. */
export interface BranchHints {
  /** The branch `refs/remotes/origin/HEAD` points at (without `origin/`). */
  originHead?: string | null;
  /** The checked-out (possibly unborn) branch; absent when HEAD is detached. */
  current?: string | null;
  /** `init.defaultBranch` from git config. */
  initDefault?: string | null;
}

/**
 * Pick the default branch for a new config: `origin/HEAD` if set, else the
 * current branch, else `init.defaultBranch`, else `main`. Blank hints are
 * ignored.
 */
export function chooseDefaultBranch(hints: BranchHints): string {
  for (const hint of [hints.originHead, hints.current, hints.initDefault]) {
    const name = hint?.trim();
    if (name) return name;
  }
  return FALLBACK_DEFAULT_BRANCH;
}

/**
 * Create a default Config with sensible defaults (`defaultBranch` overrides
 * `git.defaultBranch`, which is otherwise `main`).
 */
export function createDefaultConfig(
  options: { defaultBranch?: string } = {},
): Config {
  const defaultLabelNames = ['bug', 'feature', 'enhancement', 'docs', 'chore'];
  return {
    version: 1,
    statuses: defaultStatusDefinitions(),
    labels: ensureLabelColors(defaultLabelNames, {}),
    assignees: [],
    priorities: defaultPriorityDefinitions(),
    defaultStatus: DEFAULT_STATUS,
    defaultPriority: DEFAULT_PRIORITY,
    git: {
      ...DEFAULT_GIT,
      ...(options.defaultBranch
        ? { defaultBranch: options.defaultBranch }
        : {}),
    },
  };
}

/**
 * Status and priority names: lowercase letters, digits, `_` and `-`,
 * starting with a letter or digit (list filters are comma-separated and
 * case-insensitive, so names can't contain commas or differ only by case).
 */
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
/** Status / priority badge colors. */
const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const STATUS_KEYS = new Set(['name', 'label', 'color', 'closed']);
const PRIORITY_KEYS = new Set(['name', 'label', 'color']);

/** The optional workflow-status keys and whether each must be closed. */
const WORKFLOW_KEYS = [
  ['activeStatus', false],
  ['unclaimStatus', false],
  ['reviewStatus', false],
  ['closeStatus', true],
  ['cancelStatus', true],
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check one `statuses` / `priorities` entry (a plain name, or a definition
 * object); returns its name, or null (with `errors` added) if invalid.
 */
function checkEntry(
  entry: unknown,
  where: string,
  allowed: ReadonlySet<string>,
  errors: string[],
): string | null {
  if (typeof entry === 'string') {
    if (!NAME_RE.test(entry)) {
      errors.push(
        `${where}: invalid name ${JSON.stringify(entry)} (use lowercase letters, digits, "_" and "-")`,
      );
      return null;
    }
    return entry;
  }
  if (!isPlainObject(entry)) {
    errors.push(`${where}: must be a name or an object with a "name"`);
    return null;
  }
  let ok = true;
  for (const key of Object.keys(entry)) {
    if (!allowed.has(key)) {
      errors.push(
        `${where}: unknown key "${key}" (allowed: ${[...allowed].join(', ')})`,
      );
      ok = false;
    }
  }
  if (typeof entry.name !== 'string' || !NAME_RE.test(entry.name)) {
    errors.push(
      `${where}: invalid name ${JSON.stringify(entry.name)} (use lowercase letters, digits, "_" and "-")`,
    );
    ok = false;
  }
  if (
    entry.label !== undefined &&
    (typeof entry.label !== 'string' || !entry.label.trim())
  ) {
    errors.push(`${where}: label must be a non-empty string`);
    ok = false;
  }
  if (
    entry.color !== undefined &&
    (typeof entry.color !== 'string' || !COLOR_RE.test(entry.color))
  ) {
    errors.push(`${where}: color must be a hex color like "#4dba6f"`);
    ok = false;
  }
  if (entry.closed !== undefined && typeof entry.closed !== 'boolean') {
    errors.push(`${where}: closed must be true or false`);
    ok = false;
  }
  return ok ? (entry.name as string) : null;
}

/**
 * Check a `statuses` / `priorities` list; returns the valid entries' names
 * (and, for statuses, closed flags), or null if the list itself is invalid.
 */
function checkList(
  value: unknown,
  key: 'statuses' | 'priorities',
  errors: string[],
): Map<string, boolean> | null {
  if (!Array.isArray(value)) {
    errors.push(`${key} must be a list`);
    return null;
  }
  if (value.length === 0) {
    errors.push(`${key} must not be empty`);
    return null;
  }
  const allowed = key === 'statuses' ? STATUS_KEYS : PRIORITY_KEYS;
  const names = new Map<string, boolean>();
  let ok = true;
  value.forEach((entry: unknown, i) => {
    const name = checkEntry(entry, `${key}[${i}]`, allowed, errors);
    if (name === null) {
      ok = false;
      return;
    }
    if (names.has(name)) {
      errors.push(`${key}[${i}]: duplicate name "${name}"`);
      ok = false;
      return;
    }
    if (key === 'statuses' && name === 'all') {
      errors.push(`${key}[${i}]: "all" is reserved (it means every status)`);
      ok = false;
      return;
    }
    const closed =
      isPlainObject(entry) && typeof entry.closed === 'boolean'
        ? entry.closed
        : isLegacyClosed(name);
    names.set(name, closed);
  });
  return ok ? names : null;
}

/** Check the status-valued keys against the (valid) statuses. */
function checkWorkflow(
  obj: Record<string, unknown>,
  statuses: Map<string, boolean>,
  errors: string[],
): void {
  const list = [...statuses.keys()].join(', ');
  const open = [...statuses.values()].filter((closed) => !closed).length;
  if (open === 0) errors.push('statuses: at least one must be open');
  if (open === statuses.size) {
    errors.push('statuses: at least one must be closed (closed: true)');
  }
  const check = (key: string, mustBeClosed: boolean, required: boolean) => {
    const value = obj[key];
    if (value === undefined && !required) return;
    if (typeof value !== 'string') {
      errors.push(`${key} must be a status name`);
      return;
    }
    const closed = statuses.get(value);
    if (closed === undefined) {
      errors.push(`${key} "${value}" is not a configured status (${list})`);
    } else if (closed !== mustBeClosed) {
      errors.push(
        `${key} "${value}" must be ${mustBeClosed ? 'a closed' : 'an open'} status`,
      );
    }
  };
  check('defaultStatus', false, true);
  for (const [key, mustBeClosed] of WORKFLOW_KEYS) {
    check(key, mustBeClosed, false);
  }
  if (
    typeof obj.unclaimStatus === 'string' &&
    obj.unclaimStatus === obj.activeStatus
  ) {
    errors.push('unclaimStatus must differ from activeStatus');
  }
  if (typeof obj.reviewStatus === 'string') {
    // Compare with the resolved statuses: the active and unclaim keys can be unset.
    const workflow = {
      statuses: [...statuses].map(([name, closed]) => ({ name, closed })),
      defaultStatus: String(obj.defaultStatus),
      ...(typeof obj.activeStatus === 'string'
        ? { activeStatus: obj.activeStatus }
        : {}),
      ...(typeof obj.unclaimStatus === 'string'
        ? { unclaimStatus: obj.unclaimStatus }
        : {}),
    };
    const active = activeStatus(workflow);
    const unclaim = unclaimStatus(workflow);
    if (obj.reviewStatus === active) {
      errors.push(
        `reviewStatus "${obj.reviewStatus}" must differ from the active status`,
      );
    } else if (obj.reviewStatus === unclaim) {
      errors.push(
        `reviewStatus "${obj.reviewStatus}" must differ from the unclaim status`,
      );
    }
  }
}

/**
 * Every problem with a config (empty if it is valid), as readable messages.
 * Accepts the file form (`statuses` / `priorities` entries may be plain
 * names or definition objects) and so also a parsed {@link Config}.
 *
 * Rules: statuses and priorities are non-empty lists of unique names
 * (lowercase letters, digits, `_`, `-`; `all` is not a status) with optional
 * `label` / hex `color` (and, for statuses, `closed`); at least one status is
 * open and one closed; `defaultStatus` is a configured open status and
 * `defaultPriority` a configured priority; `activeStatus` / `unclaimStatus`,
 * if set, are configured open statuses (and differ); `reviewStatus`, if set,
 * is a configured open status other than the (resolved) active and unclaim
 * statuses; `closeStatus` /
 * `cancelStatus`, if set, are configured closed statuses.
 */
export function configErrors(value: unknown): string[] {
  if (!isPlainObject(value)) return ['config must be a YAML object'];
  const obj = value;
  const errors: string[] = [];

  if (typeof obj.version !== 'number') errors.push('version must be a number');
  // Legacy ID counter: optional, but must be a number if present.
  if (obj.nextId !== undefined && typeof obj.nextId !== 'number') {
    errors.push('nextId must be a number');
  }

  const statuses = checkList(obj.statuses, 'statuses', errors);
  if (statuses) {
    checkWorkflow(obj, statuses, errors);
  } else if (typeof obj.defaultStatus !== 'string') {
    errors.push('defaultStatus must be a status name');
  }

  const priorities = checkList(obj.priorities, 'priorities', errors);
  if (typeof obj.defaultPriority !== 'string') {
    errors.push('defaultPriority must be a priority name');
  } else if (priorities && !priorities.has(obj.defaultPriority)) {
    errors.push(
      `defaultPriority "${obj.defaultPriority}" is not a configured priority (${[...priorities.keys()].join(', ')})`,
    );
  }

  // labels: a map of label name -> color
  if (!isPlainObject(obj.labels)) {
    errors.push('labels must be a map of label name to color');
  } else if (Object.values(obj.labels).some((v) => typeof v !== 'string')) {
    errors.push('labels: every color must be a string');
  }

  // assignees: optional (defaults to [] for backward compat)
  if (obj.assignees !== undefined) {
    if (
      !Array.isArray(obj.assignees) ||
      obj.assignees.some(
        (a: unknown) =>
          !isPlainObject(a) ||
          typeof a.name !== 'string' ||
          typeof a.email !== 'string',
      )
    ) {
      errors.push('assignees must be a list of { name, email }');
    }
  }

  // git: optional
  if (obj.git !== undefined) {
    const git = obj.git;
    if (
      !isPlainObject(git) ||
      typeof git.autoCommit !== 'boolean' ||
      typeof git.autoPush !== 'boolean' ||
      typeof git.commitPrefix !== 'string' ||
      typeof git.defaultBranch !== 'string'
    ) {
      errors.push(
        'git must have boolean autoCommit/autoPush and string commitPrefix/defaultBranch',
      );
    }
  }

  return errors;
}

/** Whether `value` is a valid config (see {@link configErrors}). */
export function validateConfig(value: unknown): value is Config {
  return configErrors(value).length === 0;
}

/** Normalize a (valid) `statuses` entry to a definition. */
function toStatusDefinition(entry: unknown): StatusDefinition {
  if (typeof entry === 'string') {
    return { name: entry, closed: isLegacyClosed(entry) };
  }
  const e = entry as Record<string, unknown>;
  const name = e.name as string;
  return {
    name,
    ...(typeof e.label === 'string' ? { label: e.label } : {}),
    ...(typeof e.color === 'string' ? { color: e.color } : {}),
    closed: typeof e.closed === 'boolean' ? e.closed : isLegacyClosed(name),
  };
}

/** Normalize a (valid) `priorities` entry to a definition. */
function toPriorityDefinition(entry: unknown): PriorityDefinition {
  if (typeof entry === 'string') return { name: entry };
  const e = entry as Record<string, unknown>;
  const def: PriorityDefinition = { name: e.name as string };
  if (typeof e.label === 'string') def.label = e.label;
  if (typeof e.color === 'string') def.color = e.color;
  return def;
}

/**
 * Parse a YAML string into a Config, validating and applying defaults.
 *
 * The YAML is loaded with js-yaml's CORE_SCHEMA: no `!!js/*` types (a crafted
 * config from a malicious clone/PR can't inject functions or regexps) and no
 * timestamp/binary/set/omap types, so every value is a plain string, number,
 * boolean, null, array or object. Unknown tags such as `!!js/function` throw.
 */
export function parseConfig(yamlStr: string): Config {
  const raw = yaml.load(yamlStr, { schema: yaml.CORE_SCHEMA }) as Record<
    string,
    unknown
  >;

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

  // Migrate labels: handle both old format (array + labelColors) and new format (map)
  const rawLabels = raw.labels;
  const rawLabelColors = (
    typeof raw.labelColors === 'object' &&
    raw.labelColors !== null &&
    !Array.isArray(raw.labelColors)
      ? raw.labelColors
      : {}
  ) as Record<string, string>;

  if (Array.isArray(rawLabels)) {
    // Old format: labels is string[], merge with labelColors
    raw.labels = ensureLabelColors(rawLabels as string[], rawLabelColors);
  } else if (typeof rawLabels === 'object' && rawLabels !== null) {
    // New format: labels is already a map, merge any leftover labelColors
    raw.labels = {
      ...(rawLabels as Record<string, string>),
      ...rawLabelColors,
    };
  } else {
    // Missing or invalid — use labelColors if present, else empty
    raw.labels = { ...rawLabelColors };
  }

  // Remove the old field so it doesn't appear in serialized output
  delete raw.labelColors;

  // Default assignees to empty array if missing (backward compat)
  if (!raw.assignees) {
    raw.assignees = [];
  }

  const errors = configErrors(raw);
  if (errors.length > 0) throw new Error(errors.join('; '));

  // Plain-name entries (the legacy format) become definitions: `done` /
  // `cancelled` are closed, any other name is open.
  raw.statuses = (raw.statuses as unknown[]).map(toStatusDefinition);
  raw.priorities = (raw.priorities as unknown[]).map(toPriorityDefinition);
  return raw as unknown as Config;
}

/**
 * Find an assignee by email in the config's assignee list.
 */
export function findAssigneeByEmail(
  assignees: Assignee[],
  email: string,
): Assignee | undefined {
  return assignees.find((a) => a.email.toLowerCase() === email.toLowerCase());
}

/**
 * Resolve an assignee string to a display name.
 * Returns the name if found in config, otherwise returns the raw value.
 */
export function resolveAssigneeName(
  assignees: Assignee[],
  assigneeValue: string,
): string {
  if (!assigneeValue) return '';
  const found = findAssigneeByEmail(assignees, assigneeValue);
  return found ? found.name : assigneeValue;
}

/**
 * Serialize a Config to a YAML string.
 *
 * Uses js-yaml's default dump schema (not CORE_SCHEMA) so strings that a
 * YAML 1.1 / timestamp-aware reader would misinterpret (e.g. `2026-01-01`,
 * `yes`) are still quoted, and the default single-quote style to keep
 * existing config files byte-identical.
 */
export function serializeConfig(config: Config): string {
  return yaml.dump(
    {
      ...config,
      statuses: config.statuses.map(compactStatus),
      priorities: config.priorities.map(compactPriority),
    },
    { lineWidth: -1 },
  );
}

/**
 * A status as written to `config.yaml`: its plain name when that says
 * everything (no label/color, and `closed` is the default for the name: true
 * only for `done` / `cancelled`), else `{ name, label?, color?, closed }`. So
 * a plain-list config is written back unchanged (and stays readable by older
 * gitrac versions) until a status needs more than a name.
 */
function compactStatus(def: StatusDefinition): string | StatusDefinition {
  if (
    def.label === undefined &&
    def.color === undefined &&
    def.closed === isLegacyClosed(def.name)
  ) {
    return def.name;
  }
  return {
    name: def.name,
    ...(def.label !== undefined ? { label: def.label } : {}),
    ...(def.color !== undefined ? { color: def.color } : {}),
    closed: def.closed,
  };
}

/** A priority as written: its plain name unless it has a label or color. */
function compactPriority(def: PriorityDefinition): string | PriorityDefinition {
  if (def.label === undefined && def.color === undefined) return def.name;
  const out: PriorityDefinition = { name: def.name };
  if (def.label !== undefined) out.label = def.label;
  if (def.color !== undefined) out.color = def.color;
  return out;
}
