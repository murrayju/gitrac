import { describe, expect, test } from 'bun:test';
import {
  classifyGitError,
  conflictCommands,
  gitErrorLine,
  integrationPlan,
  overwrittenFiles,
  parseIncluded,
  parsePushPorcelain,
  pullCommand,
  pushAcceptedEverywhere,
  redactUrl,
  remoteError,
  summarizeSync,
} from './sync.ts';

describe('integrationPlan', () => {
  test('never rebases: nothing, fast-forward or merge', () => {
    expect(integrationPlan(0, 0)).toBe('none');
    expect(integrationPlan(3, 0)).toBe('none');
    expect(integrationPlan(0, 2)).toBe('fast-forward');
    expect(integrationPlan(1, 2)).toBe('merge');
  });
});

describe('parseIncluded', () => {
  test('unset and true values include; false values exclude', () => {
    expect(parseIncluded(null)).toBe(true);
    for (const v of ['true', 'yes', 'on', '1', 'TRUE']) {
      expect(parseIncluded(v)).toBe(true);
    }
    for (const v of ['false', 'no', 'off', '0', '', ' False ']) {
      expect(parseIncluded(v)).toBe(false);
    }
  });
});

describe('redactUrl', () => {
  test('hides credentials in http(s) URLs', () => {
    expect(redactUrl('https://user:secret@github.com/a/b.git')).toBe(
      'https://***@github.com/a/b.git',
    );
    expect(redactUrl('https://ghp_token@github.com/a/b.git')).toBe(
      'https://***@github.com/a/b.git',
    );
  });

  test('keeps URLs without credentials and ssh user names', () => {
    for (const url of [
      'https://github.com/a/b.git',
      'git@github.com:a/b.git',
      'ssh://git@host/a.git',
      '/srv/repo.git',
      '../remote.git',
    ]) {
      expect(redactUrl(url)).toBe(url);
    }
  });

  test('hides an ssh password', () => {
    expect(redactUrl('ssh://git:pw@host/a.git')).toBe('ssh://***@host/a.git');
  });
});

describe('commands', () => {
  test('pull without rebase, quoting odd names', () => {
    expect(pullCommand('origin', 'main')).toBe(
      'git pull --no-rebase origin main',
    );
    expect(pullCommand('my remote', "it's")).toBe(
      `git pull --no-rebase 'my remote' 'it'\\''s'`,
    );
    expect(conflictCommands('origin', 'main')[0]).toBe(
      'git pull --no-rebase origin main',
    );
  });
});

describe('push porcelain (#124)', () => {
  // A remote with two push URLs: git prints one `To` block per URL.
  const twoUrls = [
    'To git@github.com:me/repo.git',
    ' \trefs/heads/main:refs/heads/main\ta4334b1..a00e5e0',
    'Done',
    'To ssh://git@example.org:55588/me/repo.git',
    ' \trefs/heads/main:refs/heads/main\ta4334b1..a00e5e0',
    'Done',
  ].join('\n');

  test('parses one status per URL', () => {
    expect(parsePushPorcelain(twoUrls)).toEqual([
      {
        url: 'git@github.com:me/repo.git',
        flag: ' ',
        summary: 'a4334b1..a00e5e0',
      },
      {
        url: 'ssh://git@example.org:55588/me/repo.git',
        flag: ' ',
        summary: 'a4334b1..a00e5e0',
      },
    ]);
    expect(
      parsePushPorcelain(
        'To ../b.git\n!\trefs/heads/main:refs/heads/main\t[rejected] (fetch first)\nDone',
      ),
    ).toEqual([
      { url: '../b.git', flag: '!', summary: '[rejected] (fetch first)' },
    ]);
    expect(parsePushPorcelain('')).toEqual([]);
  });

  test('accepted everywhere only when every URL took the ref', () => {
    const statuses = parsePushPorcelain(twoUrls);
    expect(pushAcceptedEverywhere(statuses, 2)).toBe(true);
    // A URL that git could not reach prints no block.
    expect(pushAcceptedEverywhere(statuses.slice(0, 1), 2)).toBe(false);
    expect(
      pushAcceptedEverywhere(
        [...statuses, { url: 'x', flag: '!', summary: '[remote rejected]' }],
        3,
      ),
    ).toBe(false);
    expect(pushAcceptedEverywhere([], 1)).toBe(false);
    expect(pushAcceptedEverywhere(statuses, 0)).toBe(false);
  });
});

describe('classifyGitError', () => {
  test('recognizes common failures', () => {
    expect(
      classifyGitError(
        "fatal: could not read Username for 'https://x': terminal prompts disabled",
      ),
    ).toBe('auth');
    expect(
      classifyGitError(
        'git@host: Permission denied (publickey).\nfatal: Could not read from remote repository.',
      ),
    ).toBe('auth');
    expect(
      classifyGitError(
        "fatal: unable to access 'https://x/': Could not resolve host: x",
      ),
    ).toBe('unreachable');
    expect(
      classifyGitError(
        "fatal: '/nope' does not appear to be a git repository\nfatal: Could not read from remote repository.",
      ),
    ).toBe('unreachable');
    expect(
      classifyGitError(' ! [rejected]        main -> main (fetch first)'),
    ).toBe('rejected');
    expect(
      classifyGitError(
        'error: Your local changes to the following files would be overwritten by merge:\n\tf\n',
      ),
    ).toBe('local-changes');
    expect(classifyGitError('fatal: something else')).toBe('git');
    expect(classifyGitError('', { timedOut: true })).toBe('timeout');
  });
});

describe('overwrittenFiles', () => {
  test('lists the files after git message', () => {
    const stderr =
      'error: Your local changes to the following files would be overwritten by merge:\n\ta.txt\n  b/c.md\nPlease commit your changes or stash them before you merge.\nAborting\n';
    expect(overwrittenFiles(stderr)).toEqual(['a.txt', 'b/c.md']);
    expect(overwrittenFiles('fatal: x')).toEqual([]);
  });
});

describe('gitErrorLine', () => {
  test('prefers the fatal line and drops the prefix and hints', () => {
    expect(
      gitErrorLine('hint: try this\nfatal: bad thing happened\nmore\n'),
    ).toBe('bad thing happened');
    expect(gitErrorLine('')).toBe('git failed');
  });
});

describe('remoteError', () => {
  test('conflict names the remote and the terminal steps', () => {
    const error = remoteError('conflict', 'origin', 'main', {
      files: ['a.md'],
    });
    expect(error.message).toContain('origin/main');
    expect(error.message).toContain('a.md');
    expect(error.commands?.[0]).toBe('git pull --no-rebase origin main');
    expect(error.files).toEqual(['a.md']);
  });

  test('local changes lists the files from stderr', () => {
    const error = remoteError('local-changes', 'origin', 'main', {
      stderr:
        'error: Your local changes to the following files would be overwritten by merge:\n\tf.txt\nAborting',
    });
    expect(error.files).toEqual(['f.txt']);
    expect(error.message).toContain('f.txt');
  });

  test('rejected push suggests syncing again', () => {
    expect(remoteError('rejected', 'up', 'main').message).toContain(
      'Sync again',
    );
  });
});

describe('summarizeSync', () => {
  const remote = (
    overrides: Partial<{
      included: boolean;
      hasBranch: boolean;
      ahead: number;
      behind: number;
      conflicts: string[] | null;
    }> = {},
  ) => ({
    included: true,
    hasBranch: true,
    ahead: 0,
    behind: 0,
    conflicts: null,
    ...overrides,
  });
  const summary = (
    remotes: ReturnType<typeof remote>[],
    extra: { branch?: string | null; operation?: 'merge' | null } = {},
  ) =>
    summarizeSync({
      branch: extra.branch === undefined ? 'main' : extra.branch,
      operation: extra.operation ?? null,
      remotes,
    });

  test('in sync, out of sync and conflict', () => {
    expect(summary([remote()])).toEqual({
      state: 'in-sync',
      ahead: 0,
      behind: 0,
    });
    expect(summary([remote({ ahead: 2 }), remote({ behind: 1 })])).toEqual({
      state: 'out-of-sync',
      ahead: 2,
      behind: 1,
    });
    expect(
      summary([remote({ ahead: 1, behind: 1, conflicts: ['a'] })]).state,
    ).toBe('conflict');
    expect(
      summary([remote({ ahead: 1, behind: 1, conflicts: [] })]).state,
    ).toBe('out-of-sync');
  });

  test('excluded remotes and remotes without the branch do not count', () => {
    expect(
      summary([remote(), remote({ included: false, ahead: 5 })]).state,
    ).toBe('in-sync');
    expect(summary([remote({ included: false })]).state).toBe('excluded');
    expect(summary([remote({ hasBranch: false, ahead: 3 })]).state).toBe(
      'not-published',
    );
    expect(summary([]).state).toBe('no-remotes');
  });

  test('an operation in progress or a detached HEAD wins', () => {
    expect(summary([remote({ ahead: 1 })], { operation: 'merge' }).state).toBe(
      'operation',
    );
    expect(summary([remote()], { branch: null }).state).toBe('detached');
  });
});
