import type {
  Config,
  Priority,
  PriorityDefinition,
  Status,
  StatusDefinition,
} from '../../../core/types.ts';
import {
  defaultPriorityDefinitions,
  defaultStatusDefinitions,
  findPriority,
  findStatus,
  priorityLabel,
  priorityNames,
  statusLabel,
  statusNames,
} from '../../../core/workflow.ts';

/**
 * The configured statuses and priorities as the UI needs them (dropdown
 * options, labels, badge styles), from `config.yaml` via `useConfig()`.
 * Before the config has loaded, the built-in defaults are used.
 */

export type WorkflowSource = Pick<Config, 'statuses' | 'priorities'>;

export interface WorkflowView {
  /** Statuses and priorities to judge/sort by (the config, or defaults). */
  source: WorkflowSource;
  /** Status names in workflow order (dropdowns, filters). */
  statuses: Status[];
  /** Priority names, most urgent first. */
  priorities: Priority[];
  /** Display name by status name. */
  statusLabels: Record<string, string>;
  /** Display name by priority name. */
  priorityLabels: Record<string, string>;
}

const FALLBACK: WorkflowSource = {
  statuses: defaultStatusDefinitions(),
  priorities: defaultPriorityDefinitions(),
};

export function workflowView(config: WorkflowSource | null): WorkflowView {
  const source = config ?? FALLBACK;
  const statuses = statusNames(source);
  const priorities = priorityNames(source);
  return {
    source,
    statuses,
    priorities,
    statusLabels: Object.fromEntries(
      statuses.map((s) => [s, statusLabel(source, s)]),
    ),
    priorityLabels: Object.fromEntries(
      priorities.map((p) => [p, priorityLabel(source, p)]),
    ),
  };
}

/** Badge look: Tailwind classes, plus inline colors for a configured color. */
export interface BadgeStyle {
  className: string;
  style?: { backgroundColor?: string; color?: string };
}

/** Built-in status badge colors (used when a status has no `color`). */
const BUILTIN_STATUS_CLASSES: Record<string, string> = {
  backlog: 'bg-gray-700 text-gray-300',
  todo: 'bg-blue-900 text-blue-300',
  in_progress: 'bg-amber-900 text-amber-300',
  done: 'bg-green-900 text-green-300',
  cancelled: 'bg-red-900 text-red-300',
};
const DEFAULT_STATUS_CLASS = 'bg-gray-700 text-gray-300';

/** Built-in priority dot colors (used when a priority has no `color`). */
const BUILTIN_PRIORITY_CLASSES: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
  none: 'bg-gray-500',
};
const DEFAULT_PRIORITY_CLASS = 'bg-gray-500';

/** `#abc` -> `#aabbcc` (config colors are `#rgb` or `#rrggbb`). */
export function expandHex(color: string): string {
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : color;
}

/**
 * The status badge look: a configured `color` tints the badge (translucent
 * background, colored text); otherwise the built-in colors by name
 * (backlog gray, todo blue, in_progress amber, done green, cancelled red),
 * gray for anything else.
 */
export function statusBadgeStyle(
  source: WorkflowSource,
  status: Status,
): BadgeStyle {
  const def: StatusDefinition | undefined = findStatus(source, status);
  if (def?.color) {
    const color = expandHex(def.color);
    return { className: '', style: { backgroundColor: `${color}33`, color } };
  }
  return { className: BUILTIN_STATUS_CLASSES[status] ?? DEFAULT_STATUS_CLASS };
}

/** The priority dot look: its configured `color`, else built-in, else gray. */
export function priorityDotStyle(
  source: WorkflowSource,
  priority: Priority,
): BadgeStyle {
  const def: PriorityDefinition | undefined = findPriority(source, priority);
  if (def?.color) {
    return { className: '', style: { backgroundColor: expandHex(def.color) } };
  }
  return {
    className: BUILTIN_PRIORITY_CLASSES[priority] ?? DEFAULT_PRIORITY_CLASS,
  };
}
