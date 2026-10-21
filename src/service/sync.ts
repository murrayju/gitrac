import { GitracError } from '../core/errors.ts';
import {
  integrationPlan,
  operationMessage,
  type RemoteSyncError,
  type RemoteSyncOutcome,
  type RemoteSyncStatus,
  remoteError,
  type SyncOperation,
  type SyncResult,
  type SyncStatus,
  summarizeSync,
} from '../core/sync.ts';
import { withRepoLock } from '../git/lock.ts';
import {
  aheadBehind,
  commitList,
  countCommits,
  currentBranch,
  fastForward,
  fetchRemote,
  type GitFailure,
  lastFetchTimes,
  listRemotes,
  mergeCommit,
  mergeConflicts,
  operationInProgress,
  orderRemotes,
  pushBranch,
  type RemoteInfo,
  rawRemoteUrls,
  recordFetch,
  resolveCommit,
  setRemoteIncluded,
  trackingRef,
} from '../git/remotes.ts';
import type { ServiceContext } from './context.ts';

/**
 * Sync the current branch with git remotes: status (local refs only),
 * fetch, pull (merge, never rebase), push (fast-forward only, never forced)
 * and sync (fetch, merge, push). Used by the web UI (`src/web/routes/sync.ts`)
 * and shaped so a `gitrac sync` command can use it too.
 *
 * Network commands never prompt and have a time limit. Fetches run outside
 * the repo lock; merges and pushes run under it, so no gitrac edit (or web
 * amend) runs between them.
 */

/** Options for the sync operations. */
export interface SyncOptions {
  /**
   * Only this remote. Unset: every remote included in the simple sync
   * (`remote.<name>.gitracSync`, default included).
   */
  remote?: string;
  /** Time limit per network command (default: `NETWORK_TIMEOUT_MS`). */
  timeoutMs?: number;
}

/** The sync state of the current branch with every remote (no network). */
export async function syncStatus(dir: string): Promise<SyncStatus> {
  const [branch, operation, all, urls] = await Promise.all([
    currentBranch(dir),
    operationInProgress(dir),
    listRemotes(dir),
    rawRemoteUrls(dir),
  ]);
  const remotes = await orderRemotes(dir, branch, all);
  const [local, fetched] = await Promise.all([
    branch ? resolveCommit(dir, `refs/heads/${branch}`) : null,
    lastFetchTimes(
      dir,
      remotes.map((r) => ({ name: r.name, rawUrl: urls.get(r.name) ?? '' })),
    ),
  ]);
  const statuses = await Promise.all(
    remotes.map((remote) =>
      remoteStatus(
        dir,
        remote,
        branch,
        local,
        fetched.get(remote.name) ?? null,
      ),
    ),
  );
  return {
    branch,
    operation,
    remotes: statuses,
    summary: summarizeSync({ branch, operation, remotes: statuses }),
  };
}

async function remoteStatus(
  dir: string,
  remote: RemoteInfo,
  branch: string | null,
  local: string | null,
  lastFetch: string | null,
): Promise<RemoteSyncStatus> {
  const empty = { commits: [], more: 0 };
  const base: RemoteSyncStatus = {
    ...remote,
    hasBranch: false,
    ahead: 0,
    behind: 0,
    toPush: empty,
    toPull: empty,
    conflicts: null,
    lastFetch,
  };
  if (!branch) return base;
  const theirs = await resolveCommit(dir, trackingRef(remote.name, branch));
  if (!theirs) {
    // Not on the remote: everything here would be pushed to create it.
    if (!local) return base;
    const ahead = await countCommits(dir, local);
    return {
      ...base,
      ahead,
      toPush: await commitList(dir, local, null, ahead),
    };
  }
  if (!local) {
    const behind = await countCommits(dir, theirs);
    return {
      ...base,
      hasBranch: true,
      behind,
      toPull: await commitList(dir, theirs, null, behind),
    };
  }
  const { ahead, behind } = await aheadBehind(dir, local, theirs);
  const [toPush, toPull, conflicts] = await Promise.all([
    commitList(dir, local, theirs, ahead),
    commitList(dir, theirs, local, behind),
    ahead > 0 && behind > 0 ? mergeConflicts(dir, local, theirs) : null,
  ]);
  return {
    ...base,
    hasBranch: true,
    ahead,
    behind,
    toPush,
    toPull,
    conflicts,
  };
}

/**
 * Include or exclude `remote` from the simple sync (local git config, per
 * clone). Throws `not_found` for an unknown remote.
 */
export async function setSyncIncluded(
  ctx: ServiceContext,
  remote: string,
  included: boolean,
): Promise<SyncStatus> {
  return withRepoLock(ctx.dir, async () => {
    await requireRemote(ctx.dir, remote);
    await setRemoteIncluded(ctx.dir, remote, included);
    return syncStatus(ctx.dir);
  });
}

/** Fetch the included remotes (or `options.remote`). */
export async function fetchRemotes(
  ctx: ServiceContext,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const { branch, remotes } = await fetchTargets(ctx.dir, options);
  const outcomes = await fetchAll(ctx.dir, remotes, branch ?? '', options);
  return result('fetch', branch ?? '', remotes, outcomes);
}

/**
 * Fetch, then merge `<remote>/<branch>` into the current branch for each
 * target remote that has the branch: a fast-forward if possible, else a
 * merge commit (gitrac's merge driver merges `.issues/`). A merge with
 * conflicts is aborted, so the work tree is as before.
 */
export async function pullRemotes(
  ctx: ServiceContext,
  options: SyncOptions = {},
): Promise<SyncResult> {
  return runSync(ctx, 'pull', options);
}

/**
 * Push the current branch to each target remote (fast-forward only). An
 * explicit `options.remote` without the branch gets it created; the simple
 * push skips such remotes.
 */
export async function pushRemotes(
  ctx: ServiceContext,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const { branch, remotes } = await targets(ctx.dir, options);
  return withRepoLock(ctx.dir, async () => {
    await refuseOperation(ctx.dir);
    const outcomes = new Map<string, RemoteSyncOutcome>();
    for (const remote of remotes) outcomes.set(remote, { remote });
    await pushAll(ctx.dir, branch, remotes, outcomes, {
      ...options,
      create: options.remote !== undefined,
    });
    return result('push', branch, remotes, outcomes);
  });
}

/**
 * The simple sync: fetch, merge each remote that has the branch (as
 * {@link pullRemotes}), then push to each remote that merged cleanly.
 */
export async function syncRemotes(
  ctx: ServiceContext,
  options: SyncOptions = {},
): Promise<SyncResult> {
  return runSync(ctx, 'sync', options);
}

async function runSync(
  ctx: ServiceContext,
  operation: 'pull' | 'sync',
  options: SyncOptions,
): Promise<SyncResult> {
  const { dir } = ctx;
  const { branch, remotes } = await targets(dir, options);
  await refuseOperation(dir);
  // Fetch outside the lock: it can take long and changes no local branch.
  const outcomes = await fetchAll(dir, remotes, branch, options);
  return withRepoLock(dir, async () => {
    await refuseOperation(dir);
    if ((await currentBranch(dir)) !== branch) {
      throw new GitracError(
        'invalid_state',
        `The current branch changed during the sync (was ${branch}). Sync again.`,
      );
    }
    const merged: string[] = [];
    for (const remote of remotes) {
      const outcome = outcomes.get(remote) ?? { remote };
      outcomes.set(remote, outcome);
      if (outcome.error) continue;
      const theirs = await resolveCommit(dir, trackingRef(remote, branch));
      if (!theirs) {
        if (options.remote !== undefined && operation === 'pull') {
          outcome.error = remoteError('no-branch', remote, branch);
        } else {
          outcome.skipped = 'no-branch';
        }
        continue;
      }
      const failure = await integrate(dir, branch, remote, theirs, outcome);
      if (failure) {
        outcome.error = failure;
        // Each later remote merges into the same tree; stop at a conflict.
        if (failure.kind === 'conflict' || failure.kind === 'local-changes') {
          markNotTried(remotes, remote, outcomes, failure);
          break;
        }
        continue;
      }
      merged.push(remote);
    }
    if (operation === 'sync') {
      await pushAll(dir, branch, merged, outcomes, options);
    }
    return result(operation, branch, remotes, outcomes);
  });
}

/** Mark the remotes after `failed` as not tried because of `failure`. */
function markNotTried(
  remotes: string[],
  failed: string,
  outcomes: Map<string, RemoteSyncOutcome>,
  failure: RemoteSyncError,
): void {
  for (const remote of remotes.slice(remotes.indexOf(failed) + 1)) {
    const outcome = outcomes.get(remote) ?? { remote };
    outcomes.set(remote, outcome);
    if (outcome.error || outcome.skipped) continue;
    outcome.error = {
      kind: 'git',
      message: `Not synced with ${remote}: first fix the problem with ${failed} (${failure.kind === 'conflict' ? 'conflicts' : 'local changes'}).`,
    };
  }
}

/** Bring `theirs` (`<remote>/<branch>`) into the current branch. */
async function integrate(
  dir: string,
  branch: string,
  remote: string,
  theirs: string,
  outcome: RemoteSyncOutcome,
): Promise<RemoteSyncError | null> {
  const local = await resolveCommit(dir, 'HEAD');
  const { ahead, behind } = local
    ? await aheadBehind(dir, local, theirs)
    : { ahead: 0, behind: 1 };
  const plan = integrationPlan(ahead, behind);
  if (plan === 'none') {
    outcome.integrated = 'up-to-date';
    return null;
  }
  const failure: GitFailure | null =
    plan === 'fast-forward'
      ? await fastForward(dir, theirs)
      : await mergeCommit(
          dir,
          theirs,
          `Merge remote-tracking branch '${remote}/${branch}'`,
        );
  if (failure) {
    return remoteError(failure.kind, remote, branch, failure);
  }
  outcome.integrated = plan;
  return null;
}

/** Push `branch` to `remotes` (in parallel); records each outcome. */
async function pushAll(
  dir: string,
  branch: string,
  remotes: string[],
  outcomes: Map<string, RemoteSyncOutcome>,
  options: SyncOptions & { create?: boolean },
): Promise<void> {
  await Promise.all(
    remotes.map(async (remote) => {
      const outcome = outcomes.get(remote) ?? { remote };
      outcomes.set(remote, outcome);
      if (outcome.error) return;
      if (!options.create) {
        const theirs = await resolveCommit(dir, trackingRef(remote, branch));
        if (!theirs) {
          outcome.skipped = 'no-branch';
          return;
        }
      }
      const pushed = await pushBranch(dir, remote, branch, options);
      if ('outcome' in pushed) outcome.pushed = pushed.outcome;
      else outcome.error = remoteError(pushed.kind, remote, branch, pushed);
    }),
  );
}

/** In-flight fetches per repo and remote, so concurrent requests share one. */
const inFlight = new Map<string, Promise<GitFailure | null>>();

/** Fetch `remotes` in parallel; records the time of each one that worked. */
async function fetchAll(
  dir: string,
  remotes: string[],
  branch: string,
  options: SyncOptions,
): Promise<Map<string, RemoteSyncOutcome>> {
  const failures = await Promise.all(
    remotes.map((remote) => {
      const key = `${dir}\0${remote}`;
      let pending = inFlight.get(key);
      if (!pending) {
        pending = fetchRemote(dir, remote, options).finally(() =>
          inFlight.delete(key),
        );
        inFlight.set(key, pending);
      }
      return pending;
    }),
  );
  const outcomes = new Map<string, RemoteSyncOutcome>();
  const ok: string[] = [];
  remotes.forEach((remote, i) => {
    const failure = failures[i];
    if (failure) {
      outcomes.set(remote, {
        remote,
        fetched: false,
        error: remoteError(failure.kind, remote, branch, failure),
      });
    } else {
      ok.push(remote);
      outcomes.set(remote, { remote, fetched: true });
    }
  });
  await recordFetchTimes(dir, ok);
  return outcomes;
}

let recording: Promise<void> = Promise.resolve();

/** Record fetch times one at a time (the file is read, then written). */
function recordFetchTimes(dir: string, remotes: string[]): Promise<void> {
  recording = recording
    .then(() => recordFetch(dir, remotes))
    .catch(() => {
      // Best effort: the time is only shown in the UI.
    });
  return recording;
}

/** The current branch (or null) and the remotes an operation works on. */
async function fetchTargets(
  dir: string,
  options: SyncOptions,
): Promise<{ branch: string | null; remotes: string[] }> {
  const branch = await currentBranch(dir);
  const all = await orderRemotes(dir, branch, await listRemotes(dir));
  if (options.remote !== undefined) {
    if (!all.some((r) => r.name === options.remote)) {
      throw remoteNotFound(options.remote);
    }
    return { branch, remotes: [options.remote] };
  }
  return { branch, remotes: all.filter((r) => r.included).map((r) => r.name) };
}

/** Like {@link fetchTargets}, but HEAD must be on a branch. */
async function targets(
  dir: string,
  options: SyncOptions,
): Promise<{ branch: string; remotes: string[] }> {
  const { branch, remotes } = await fetchTargets(dir, options);
  if (!branch) {
    throw new GitracError(
      'invalid_state',
      'HEAD is detached (not on a branch), so there is nothing to sync. Switch to a branch first.',
      { details: { reason: 'detached' } },
    );
  }
  return { branch, remotes };
}

async function requireRemote(dir: string, remote: string): Promise<void> {
  const all = await listRemotes(dir);
  if (!all.some((r) => r.name === remote)) throw remoteNotFound(remote);
}

function remoteNotFound(remote: string): GitracError {
  return new GitracError('not_found', `No remote named ${remote}`, {
    details: { remote },
  });
}

/** Refuse while a merge/rebase/... from a terminal is not finished. */
async function refuseOperation(dir: string): Promise<void> {
  const operation = await operationInProgress(dir);
  if (operation) {
    throw new GitracError('invalid_state', operationMessage(operation), {
      details: { reason: 'operation', operation },
    });
  }
}

function result(
  operation: SyncOperation,
  branch: string,
  remotes: string[],
  outcomes: Map<string, RemoteSyncOutcome>,
): SyncResult {
  const list = remotes.map((remote) => outcomes.get(remote) ?? { remote });
  return {
    operation,
    branch,
    ok: list.every((o) => !o.error),
    remotes: list,
  };
}
