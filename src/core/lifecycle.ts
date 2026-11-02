import { GitracError, invalidInput } from './errors.ts';
import type { Issue, Status } from './types.ts';
import {
  cancelStatus,
  closedStatuses,
  closeStatus,
  duplicateStatus,
  isClosedStatus,
  openStatuses,
  type StatusConfig,
  type WorkflowConfig,
} from './workflow.ts';

/**
 * Close / reopen rules shared by the CLI (`gitrac close` / `gitrac reopen`)
 * and the web API (`PATCH /api/issues/:id/close|reopen`), so both behave the
 * same. Pure functions: callers pass where the issue file currently lives.
 *
 * An issue is fully closed when its file is in `.issues/closed/` *and* its
 * status is closed (a configured status with `closed: true`; see
 * `src/core/workflow.ts`), and fully open when its file is in
 * `.issues/` *and* its status is open. Closing a fully closed issue or
 * reopening a fully open one is an `invalid_state` error (exit 3 / HTTP 409)
 * and must not touch disk. A half-way state (e.g. a hand-edited closed issue
 * still in `.issues/`) may be either closed or reopened, which repairs it.
 */

/** Throw `invalid_state` if the issue is already closed. */
export function assertCanClose(
  issue: Pick<Issue, 'id' | 'status'>,
  inClosedDir: boolean,
  config: StatusConfig,
): void {
  if (inClosedDir && isClosedStatus(config, issue.status)) {
    throw new GitracError(
      'invalid_state',
      `Issue #${issue.id} is already closed (${issue.status})`,
      { details: { id: issue.id, status: issue.status } },
    );
  }
}

/** Throw `invalid_state` if the issue is already open. */
export function assertCanReopen(
  issue: Pick<Issue, 'id' | 'status'>,
  inClosedDir: boolean,
  config: StatusConfig,
): void {
  if (!inClosedDir && !isClosedStatus(config, issue.status)) {
    throw new GitracError(
      'invalid_state',
      `Issue #${issue.id} is not closed (${issue.status})`,
      { details: { id: issue.id, status: issue.status } },
    );
  }
}

/**
 * The status a reopened issue gets: `requested` if given (it must be one of
 * the configured open statuses, else `invalid_input`), otherwise
 * `config.defaultStatus` (which config validation guarantees is open; should
 * it not be, the first open status, so a reopened issue is never closed).
 */
export function reopenStatus(
  config: WorkflowConfig,
  requested?: unknown,
): Status {
  const open = openStatuses(config);
  if (requested !== undefined) {
    if (typeof requested !== 'string' || !open.includes(requested)) {
      throw invalidInput(
        `Invalid status ${JSON.stringify(requested)} for reopen: must be one of ${open.join(', ')}`,
      );
    }
    return requested;
  }
  if (open.includes(config.defaultStatus)) return config.defaultStatus;
  return open[0] ?? config.defaultStatus;
}

/**
 * The status a closed issue gets: `options.status` if given (it must be one
 * of the configured closed statuses), else with `options.cancelled` the
 * configured cancel status, with `options.duplicate` the configured
 * duplicate status (`invalid_input` if there is none), else the configured
 * close status (see `src/core/workflow.ts`). At most one of the three
 * options can be given.
 */
export function closingStatus(
  config: WorkflowConfig,
  options: { status?: unknown; cancelled?: boolean; duplicate?: boolean } = {},
): Status {
  const closed = closedStatuses(config);
  const given = [
    options.status !== undefined,
    Boolean(options.cancelled),
    Boolean(options.duplicate),
  ].filter(Boolean).length;
  if (given > 1) {
    throw invalidInput(
      'Give only one of a status, cancelled and a duplicate-of issue',
    );
  }
  if (options.status !== undefined) {
    if (
      typeof options.status !== 'string' ||
      !closed.includes(options.status)
    ) {
      throw invalidInput(
        `Invalid status ${JSON.stringify(options.status)} for close: must be one of ${closed.join(', ')}`,
      );
    }
    return options.status;
  }
  if (options.cancelled) {
    const status = cancelStatus(config);
    if (status === undefined) {
      throw invalidInput(
        `No cancel status is configured: add a closed "cancelled" status or set cancelStatus in .issues/config.yaml (closed statuses: ${closed.join(', ')})`,
      );
    }
    return status;
  }
  if (options.duplicate) {
    const status = duplicateStatus(config);
    if (status === undefined) {
      throw invalidInput(
        `No duplicate status is configured: add a closed "duplicate" status or set duplicateStatus in .issues/config.yaml (closed statuses: ${closed.join(', ')})`,
      );
    }
    return status;
  }
  return closeStatus(config);
}

/**
 * Drop `issue.duplicateOf` unless the issue is in the duplicate status: the
 * link only holds while the issue is closed as a duplicate. Call it after
 * every status change.
 */
export function dropDuplicateLink(
  issue: Pick<Issue, 'status' | 'duplicateOf'>,
  config: WorkflowConfig,
): void {
  if (
    issue.duplicateOf !== undefined &&
    issue.status !== duplicateStatus(config)
  ) {
    delete issue.duplicateOf;
  }
}
