import type { Config, Issue, Priority, Status } from './types.ts';
import { priorityNames, statusNames } from './workflow.ts';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate an Issue against a Config.
 * Returns errors for invalid required fields and warnings for unknown labels.
 */
export function validateIssue(issue: Issue, config: Config): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!issue.id || typeof issue.id !== 'number' || issue.id <= 0) {
    errors.push('Invalid or missing id: must be a positive number');
  }

  if (!issue.title || typeof issue.title !== 'string' || !issue.title.trim()) {
    errors.push('Invalid or missing title: must be a non-empty string');
  }

  // Status must be in config.statuses
  const statuses = statusNames(config);
  if (!statuses.includes(issue.status)) {
    errors.push(
      `Invalid status "${issue.status}": must be one of ${statuses.join(', ')}`,
    );
  }

  // Priority must be in config.priorities
  const priorities = priorityNames(config);
  if (!priorities.includes(issue.priority)) {
    errors.push(
      `Invalid priority "${issue.priority}": must be one of ${priorities.join(', ')}`,
    );
  }

  // Date validation
  if (!isValidISODate(issue.created)) {
    errors.push(
      `Invalid created date "${issue.created}": must be a valid ISO 8601 date`,
    );
  }

  if (!isValidISODate(issue.updated)) {
    errors.push(
      `Invalid updated date "${issue.updated}": must be a valid ISO 8601 date`,
    );
  }

  // Labels are warnings, not errors
  for (const label of issue.labels) {
    if (!(label in config.labels)) {
      warnings.push(
        `Unknown label "${label}": not in configured labels (${Object.keys(config.labels).join(', ')})`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check whether a string is a valid ISO 8601 date.
 */
function isValidISODate(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const date = new Date(dateStr);
  return !Number.isNaN(date.getTime());
}

/** Editable issue fields accepted from the CLI or the web API. */
export interface IssueFieldValues {
  title?: string;
  status?: Status;
  priority?: Priority;
  assignee?: string;
  labels?: string[];
  description?: string;
}

export type IssueFieldsResult =
  | { valid: true; values: IssueFieldValues; errors: [] }
  | { valid: false; values?: undefined; errors: string[] };

export interface ValidateIssueFieldsOptions {
  /** Require a title to be present (create). Defaults to false (update). */
  requireTitle?: boolean;
}

/**
 * Validate (and normalize) user-supplied issue fields before they are written.
 *
 * `input` is untrusted (a JSON request body or CLI options), so every field is
 * type-checked. Only the editable fields are inspected; absent (`undefined`)
 * fields are left out of the result so callers can apply them as a partial
 * update. Normalization: title is trimmed, labels are trimmed and de-duplicated.
 *
 * Unknown labels are allowed — callers register them in the config (with a
 * color) via `registerLabels` so CLI and web behave the same.
 */
export function validateIssueFields(
  input: unknown,
  config: Config,
  options: ValidateIssueFieldsOptions = {},
): IssueFieldsResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];
  const values: IssueFieldValues = {};

  if (raw.title !== undefined) {
    if (typeof raw.title !== 'string' || !raw.title.trim()) {
      errors.push('Invalid title: must be a non-empty string');
    } else {
      values.title = raw.title.trim();
    }
  } else if (options.requireTitle) {
    errors.push('title is required');
  }

  if (raw.status !== undefined) {
    const statuses = statusNames(config);
    if (typeof raw.status !== 'string' || !statuses.includes(raw.status)) {
      errors.push(
        `Invalid status ${JSON.stringify(raw.status)}: must be one of ${statuses.join(', ')}`,
      );
    } else {
      values.status = raw.status;
    }
  }

  if (raw.priority !== undefined) {
    const priorities = priorityNames(config);
    if (
      typeof raw.priority !== 'string' ||
      !priorities.includes(raw.priority)
    ) {
      errors.push(
        `Invalid priority ${JSON.stringify(raw.priority)}: must be one of ${priorities.join(', ')}`,
      );
    } else {
      values.priority = raw.priority;
    }
  }

  if (raw.assignee !== undefined) {
    if (typeof raw.assignee !== 'string') {
      errors.push('Invalid assignee: must be a string');
    } else {
      values.assignee = raw.assignee.trim();
    }
  }

  if (raw.labels !== undefined) {
    if (!Array.isArray(raw.labels)) {
      errors.push('Invalid labels: must be an array of strings');
    } else if (raw.labels.some((l) => typeof l !== 'string' || !l.trim())) {
      errors.push('Invalid labels: each label must be a non-empty string');
    } else {
      values.labels = [
        ...new Set((raw.labels as string[]).map((l) => l.trim())),
      ];
    }
  }

  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') {
      errors.push('Invalid description: must be a string');
    } else {
      values.description = raw.description;
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, values, errors: [] };
}

/**
 * Split a comma-separated CLI label list, trimming and dropping empty entries
 * (so `-l "bug, ui,"` yields `['bug', 'ui']` and `-l ""` clears labels).
 */
export function parseLabelList(value: string): string[] {
  return value
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
