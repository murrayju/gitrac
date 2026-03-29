import type { Config, Issue } from './types.ts';

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
  if (!config.statuses.includes(issue.status)) {
    errors.push(
      `Invalid status "${issue.status}": must be one of ${config.statuses.join(', ')}`,
    );
  }

  // Priority must be in config.priorities
  if (!config.priorities.includes(issue.priority)) {
    errors.push(
      `Invalid priority "${issue.priority}": must be one of ${config.priorities.join(', ')}`,
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
    if (!config.labels.includes(label)) {
      warnings.push(
        `Unknown label "${label}": not in configured labels (${config.labels.join(', ')})`,
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
