import { GitracError, invalidInput } from './errors.ts';
import type { Config, Issue, Status } from './types.ts';
import { isClosedStatus } from './types.ts';

/**
 * Close / reopen rules shared by the CLI (`gitrac close` / `gitrac reopen`)
 * and the web API (`PATCH /api/issues/:id/close|reopen`), so both behave the
 * same. Pure functions: callers pass where the issue file currently lives.
 *
 * An issue is fully closed when its file is in `.issues/closed/` *and* its
 * status is closed (`done` / `cancelled`), and fully open when its file is in
 * `.issues/` *and* its status is open. Closing a fully closed issue or
 * reopening a fully open one is an `invalid_state` error (exit 3 / HTTP 409)
 * and must not touch disk. A half-way state (e.g. a hand-edited `done` issue
 * still in `.issues/`) may be either closed or reopened, which repairs it.
 */

/** Throw `invalid_state` if the issue is already closed. */
export function assertCanClose(
  issue: Pick<Issue, 'id' | 'status'>,
  inClosedDir: boolean,
): void {
  if (inClosedDir && isClosedStatus(issue.status)) {
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
): void {
  if (!inClosedDir && !isClosedStatus(issue.status)) {
    throw new GitracError(
      'invalid_state',
      `Issue #${issue.id} is not closed (${issue.status})`,
      { details: { id: issue.id, status: issue.status } },
    );
  }
}

/**
 * The status a reopened issue gets: `requested` if given (it must be one of
 * the configured statuses and not a closed one, else `invalid_input`),
 * otherwise `config.defaultStatus`. If the configured default is itself a
 * closed status (a misconfiguration), falls back to the first open configured
 * status so a reopened issue is never left closed.
 */
export function reopenStatus(config: Config, requested?: unknown): Status {
  if (requested !== undefined) {
    const open = config.statuses.filter((s) => !isClosedStatus(s));
    if (typeof requested !== 'string' || !open.includes(requested as Status)) {
      throw invalidInput(
        `Invalid status ${JSON.stringify(requested)} for reopen: must be one of ${open.join(', ')}`,
      );
    }
    return requested as Status;
  }
  if (!isClosedStatus(config.defaultStatus)) return config.defaultStatus;
  return config.statuses.find((s) => !isClosedStatus(s)) ?? 'backlog';
}
