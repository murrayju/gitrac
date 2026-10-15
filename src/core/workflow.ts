import type {
  Config,
  Priority,
  PriorityDefinition,
  Status,
  StatusDefinition,
} from './types.ts';

/**
 * Configurable statuses and priorities (pure; no I/O).
 *
 * `config.statuses` lists the statuses in workflow order (the order of the
 * UI's dropdowns and filters), each with a `closed` flag; `config.priorities`
 * lists the priorities most urgent first. The workflow statuses `claim`,
 * `unclaim` and `close` use are configurable too (`activeStatus`,
 * `unclaimStatus`, `closeStatus`, `cancelStatus`); when a key is unset the
 * built-in name is used if it is configured (with the right open/closed
 * kind), else a fallback — see the resolvers below. `parseConfig`
 * (`src/core/config.ts`) validates explicitly set keys.
 */

/** Built-in status names (the default config's statuses, in workflow order). */
export const DEFAULT_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'done',
  'cancelled',
] as const;

/** Built-in priority names (the default config's priorities, most urgent first). */
export const DEFAULT_PRIORITIES = [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
] as const;

/** Default `defaultStatus` / `defaultPriority` of new configs. */
export const DEFAULT_STATUS: Status = 'backlog';
export const DEFAULT_PRIORITY: Priority = 'medium';
/** Built-in `activeStatus`: the status `claim` sets. */
export const DEFAULT_ACTIVE_STATUS: Status = 'in_progress';
/** Built-in `unclaimStatus`: where `unclaim` moves an active issue. */
export const DEFAULT_UNCLAIM_STATUS: Status = 'todo';
/** Built-in `closeStatus`: the status `close` sets. */
export const DEFAULT_CLOSE_STATUS: Status = 'done';
/** Built-in `cancelStatus`: the status `close --cancelled` sets. */
export const DEFAULT_CANCEL_STATUS: Status = 'cancelled';

/**
 * Statuses that are closed when nothing says otherwise: plain-name entries
 * in `config.statuses` (the legacy format) and definitions without `closed`
 * get `closed: true` for these names and `false` for any other; a status
 * that isn't configured at all is judged the same way.
 */
export const LEGACY_CLOSED_STATUSES: readonly Status[] = ['done', 'cancelled'];

/** Whether `name` is closed by default (see {@link LEGACY_CLOSED_STATUSES}). */
export function isLegacyClosed(name: Status): boolean {
  return LEGACY_CLOSED_STATUSES.includes(name);
}

/** Plain status names as definitions (`closed` per the legacy rule). */
export function statusDefinitions(
  names: readonly Status[],
): StatusDefinition[] {
  return names.map((name) => ({ name, closed: isLegacyClosed(name) }));
}

/** Plain priority names as definitions. */
export function priorityDefinitions(
  names: readonly Priority[],
): PriorityDefinition[] {
  return names.map((name) => ({ name }));
}

/** The built-in statuses as definitions. */
export function defaultStatusDefinitions(): StatusDefinition[] {
  return statusDefinitions(DEFAULT_STATUSES);
}

/** The built-in priorities as definitions. */
export function defaultPriorityDefinitions(): PriorityDefinition[] {
  return priorityDefinitions(DEFAULT_PRIORITIES);
}

export type StatusConfig = Pick<Config, 'statuses'>;
export type PriorityConfig = Pick<Config, 'priorities'>;
/** What the workflow resolvers need. */
export type WorkflowConfig = Pick<
  Config,
  | 'statuses'
  | 'defaultStatus'
  | 'activeStatus'
  | 'unclaimStatus'
  | 'closeStatus'
  | 'cancelStatus'
>;

/** Configured status names, in workflow order. */
export function statusNames(config: StatusConfig): Status[] {
  return config.statuses.map((s) => s.name);
}

/** Configured priority names, most urgent first. */
export function priorityNames(config: PriorityConfig): Priority[] {
  return config.priorities.map((p) => p.name);
}

export function findStatus(
  config: StatusConfig,
  name: Status,
): StatusDefinition | undefined {
  return config.statuses.find((s) => s.name === name);
}

export function findPriority(
  config: PriorityConfig,
  name: Priority,
): PriorityDefinition | undefined {
  return config.priorities.find((p) => p.name === name);
}

/**
 * Whether `status` is closed: its configured `closed` flag, or — for a
 * status not in the config — whether it is `done` / `cancelled`.
 */
export function isClosedStatus(config: StatusConfig, status: Status): boolean {
  const def = findStatus(config, status);
  return def ? def.closed : isLegacyClosed(status);
}

/** Configured open statuses, in workflow order. */
export function openStatuses(config: StatusConfig): Status[] {
  return config.statuses.filter((s) => !s.closed).map((s) => s.name);
}

/** Configured closed statuses, in workflow order. */
export function closedStatuses(config: StatusConfig): Status[] {
  return config.statuses.filter((s) => s.closed).map((s) => s.name);
}

function isOpenConfigured(config: StatusConfig, name: Status): boolean {
  return findStatus(config, name)?.closed === false;
}

function isClosedConfigured(config: StatusConfig, name: Status): boolean {
  return findStatus(config, name)?.closed === true;
}

/**
 * The status `claim` sets: `config.activeStatus`; unset, `in_progress` if
 * it is a configured open status, else the last open status.
 */
export function activeStatus(config: WorkflowConfig): Status {
  if (config.activeStatus !== undefined) return config.activeStatus;
  if (isOpenConfigured(config, DEFAULT_ACTIVE_STATUS)) {
    return DEFAULT_ACTIVE_STATUS;
  }
  return openStatuses(config).at(-1) ?? DEFAULT_ACTIVE_STATUS;
}

/**
 * The status `unclaim` moves an issue in {@link activeStatus} back to:
 * `config.unclaimStatus`; unset, `todo` if it is a configured open status
 * (other than the active one), else `defaultStatus`.
 */
export function unclaimStatus(config: WorkflowConfig): Status {
  if (config.unclaimStatus !== undefined) return config.unclaimStatus;
  if (
    isOpenConfigured(config, DEFAULT_UNCLAIM_STATUS) &&
    DEFAULT_UNCLAIM_STATUS !== activeStatus(config)
  ) {
    return DEFAULT_UNCLAIM_STATUS;
  }
  return config.defaultStatus;
}

/**
 * The status `close` sets: `config.closeStatus`; unset, `done` if it is a
 * configured closed status, else the first closed status.
 */
export function closeStatus(config: WorkflowConfig): Status {
  if (config.closeStatus !== undefined) return config.closeStatus;
  if (isClosedConfigured(config, DEFAULT_CLOSE_STATUS)) {
    return DEFAULT_CLOSE_STATUS;
  }
  return closedStatuses(config)[0] ?? DEFAULT_CLOSE_STATUS;
}

/**
 * The status `close --cancelled` sets: `config.cancelStatus`; unset,
 * `cancelled` if it is a configured closed status, else none.
 */
export function cancelStatus(config: WorkflowConfig): Status | undefined {
  if (config.cancelStatus !== undefined) return config.cancelStatus;
  return isClosedConfigured(config, DEFAULT_CANCEL_STATUS)
    ? DEFAULT_CANCEL_STATUS
    : undefined;
}

/**
 * The `--sort status` order: open statuses furthest along the workflow
 * first (reverse configured order), then closed statuses in configured
 * order. For the built-in statuses: in_progress, todo, backlog, done,
 * cancelled.
 */
export function statusSortOrder(config: StatusConfig): Status[] {
  return [...openStatuses(config).reverse(), ...closedStatuses(config)];
}

/** `in_progress` -> `In Progress`. */
export function humanize(name: string): string {
  return name
    .split(/[_-]+/)
    .filter((w) => w !== '')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Display name of a status: its `label`, else the name humanized. */
export function statusLabel(config: StatusConfig, name: Status): string {
  return findStatus(config, name)?.label ?? humanize(name);
}

/** Display name of a priority: its `label`, else the name humanized. */
export function priorityLabel(config: PriorityConfig, name: Priority): string {
  return findPriority(config, name)?.label ?? humanize(name);
}
