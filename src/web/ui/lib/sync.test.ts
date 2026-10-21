import { describe, expect, test } from 'bun:test';
import {
  type RemoteSyncStatus,
  type SyncResult,
  type SyncStatus,
  summarizeSync,
} from '../../../core/sync.ts';
import {
  applyResult,
  arrows,
  canSync,
  fetchedAgo,
  indicator,
  outcomeText,
  reconcileProblems,
  type SyncProblem,
  syncBanner,
  tooltipSections,
} from './sync.ts';

function remote(overrides: Partial<RemoteSyncStatus> = {}): RemoteSyncStatus {
  return {
    name: 'origin',
    url: '/srv/origin.git',
    included: true,
    hasBranch: true,
    ahead: 0,
    behind: 0,
    toPush: { commits: [], more: 0 },
    toPull: { commits: [], more: 0 },
    conflicts: null,
    lastFetch: null,
    ...overrides,
  };
}

function status(
  remotes: RemoteSyncStatus[],
  extra: Partial<Pick<SyncStatus, 'branch' | 'operation'>> = {},
): SyncStatus {
  const branch = extra.branch === undefined ? 'main' : extra.branch;
  const operation = extra.operation ?? null;
  return {
    branch,
    operation,
    remotes,
    summary: summarizeSync({ branch, operation, remotes }),
  };
}

const conflict: SyncProblem = {
  remote: 'origin',
  operation: 'sync',
  error: {
    kind: 'conflict',
    message: 'Merging origin/main has conflicts',
    files: ['a.md'],
    commands: ['git pull --no-rebase origin main'],
  },
};

describe('arrows', () => {
  test('shows only non-zero counts', () => {
    expect(arrows(2, 1)).toBe('\u21912 \u21931');
    expect(arrows(0, 3)).toBe('\u21933');
    expect(arrows(0, 0)).toBe('');
  });
});

describe('indicator', () => {
  test('in sync, counts and not synced', () => {
    expect(indicator(status([remote()]), [])).toEqual({
      label: 'in sync',
      tone: 'ok',
    });
    expect(indicator(status([remote({ ahead: 2, behind: 1 })]), []).label).toBe(
      '\u21912 \u21931',
    );
    expect(
      indicator(status([remote({ hasBranch: false, ahead: 1 })]), []).label,
    ).toBe('not synced');
    expect(indicator(null, []).tone).toBe('muted');
  });

  test('a conflict or an operation in progress is an error', () => {
    expect(
      indicator(status([remote({ ahead: 1, behind: 1 })]), [conflict]),
    ).toEqual({
      label: 'sync conflict',
      tone: 'error',
    });
    expect(indicator(status([remote()], { operation: 'rebase' }), [])).toEqual({
      label: 'rebase in progress',
      tone: 'error',
    });
  });
});

describe('applyResult', () => {
  test('a failure is kept; a later sync that worked clears it', () => {
    const failed: SyncResult = {
      operation: 'sync',
      branch: 'main',
      ok: false,
      remotes: [{ remote: 'origin', fetched: true, error: conflict.error }],
    };
    const problems = applyResult([], failed);
    expect(problems).toEqual([conflict]);
    const fixed: SyncResult = {
      operation: 'sync',
      branch: 'main',
      ok: true,
      remotes: [
        {
          remote: 'origin',
          fetched: true,
          integrated: 'up-to-date',
          pushed: 'pushed',
        },
      ],
    };
    expect(applyResult(problems, fixed)).toEqual([]);
  });

  test('a fetch clears a network problem but not a conflict', () => {
    const fetched: SyncResult = {
      operation: 'fetch',
      branch: 'main',
      ok: true,
      remotes: [{ remote: 'origin', fetched: true }],
    };
    const auth: SyncProblem = {
      remote: 'origin',
      operation: 'fetch',
      error: { kind: 'auth', message: 'auth' },
    };
    expect(applyResult([auth], fetched)).toEqual([]);
    expect(applyResult([conflict], fetched)).toEqual([conflict]);
  });
});

describe('reconcileProblems', () => {
  test('a conflict stays while the branch is diverged with conflicts', () => {
    const diverged = status([
      remote({ ahead: 1, behind: 1, conflicts: ['a.md'] }),
    ]);
    expect(reconcileProblems([conflict], diverged)).toEqual([conflict]);
  });

  test('a conflict goes once resolved in a terminal', () => {
    // Merged and committed locally: only ahead.
    expect(
      reconcileProblems([conflict], status([remote({ ahead: 2 })])),
    ).toEqual([]);
    // Diverged but now merges cleanly (for example the other side changed).
    expect(
      reconcileProblems(
        [conflict],
        status([remote({ ahead: 1, behind: 1, conflicts: [] })]),
      ),
    ).toEqual([]);
  });

  test('problems of removed or in-sync remotes go', () => {
    const auth: SyncProblem = {
      remote: 'gone',
      operation: 'fetch',
      error: { kind: 'auth', message: 'x' },
    };
    expect(reconcileProblems([auth], status([remote()]))).toEqual([]);
  });
});

describe('syncBanner', () => {
  test('names the operation in progress and how to finish it', () => {
    const banner = syncBanner(status([remote()], { operation: 'merge' }), []);
    expect(banner?.title).toContain('merge');
    expect(banner?.commands).toEqual([
      'git merge --continue',
      'git merge --abort',
    ]);
  });

  test('a conflict from sync names the remote and the commands', () => {
    const banner = syncBanner(
      status([remote({ ahead: 1, behind: 1, conflicts: ['a.md'] })]),
      [conflict],
    );
    expect(banner?.title).toContain('origin');
    expect(banner?.commands).toEqual(['git pull --no-rebase origin main']);
  });

  test('a predicted conflict shows without a sync', () => {
    const banner = syncBanner(
      status([remote({ ahead: 1, behind: 1, conflicts: ['a.md'] })]),
      [],
    );
    expect(banner?.title).toBe('origin/main has diverged with conflicts');
    expect(banner?.commands[0]).toBe('git pull --no-rebase origin main');
  });

  test('none when everything is fine or only the network failed', () => {
    expect(syncBanner(status([remote()]), [])).toBeNull();
    expect(
      syncBanner(status([remote({ ahead: 1 })]), [
        {
          remote: 'origin',
          operation: 'fetch',
          error: { kind: 'auth', message: 'x' },
        },
      ]),
    ).toBeNull();
  });

  test('excluded remotes do not raise a banner', () => {
    expect(
      syncBanner(
        status([
          remote({ included: false, ahead: 1, behind: 1, conflicts: ['a'] }),
        ]),
        [],
      ),
    ).toBeNull();
  });
});

describe('tooltipSections', () => {
  test('lists commits per included remote and names a missing branch', () => {
    const commit = { hash: 'abc', subject: 'fix', author: 'A', date: '' };
    const sections = tooltipSections(
      status([
        remote({ ahead: 1, toPush: { commits: [commit], more: 3 } }),
        remote({ name: 'backup', hasBranch: false }),
        remote({ name: 'off', included: false }),
      ]),
      [],
    );
    expect(sections.map((s) => s.heading)).toEqual([
      '\u21911',
      'no main on backup',
    ]);
    expect(sections[0]?.toPush).toEqual({ commits: [commit], more: 3 });
  });
});

describe('canSync', () => {
  test('needs a branch, no operation and an included remote', () => {
    expect(canSync(status([remote()]))).toBe(true);
    expect(canSync(status([remote({ included: false })]))).toBe(false);
    expect(canSync(status([remote()], { operation: 'merge' }))).toBe(false);
    expect(canSync(status([remote()], { branch: null }))).toBe(false);
    expect(canSync(null)).toBe(false);
  });
});

describe('fetchedAgo / outcomeText', () => {
  test('formats', () => {
    const now = Date.parse('2026-01-01T01:00:00Z');
    expect(fetchedAgo(null, now)).toBe('never fetched');
    expect(fetchedAgo('2026-01-01T00:59:30Z', now)).toBe('fetched just now');
    expect(fetchedAgo('2026-01-01T00:55:00Z', now)).toBe('fetched 5m ago');
    expect(
      outcomeText({ remote: 'o', integrated: 'merge', pushed: 'pushed' }),
    ).toBe('merged, pushed');
    expect(outcomeText({ remote: 'o', fetched: true })).toBe('fetched');
    expect(outcomeText({ remote: 'o', skipped: 'no-branch' })).toBe(
      'skipped (no branch)',
    );
  });
});
