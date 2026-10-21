import { describe, expect, test } from 'bun:test';
import {
  type BranchState,
  branchBlocker,
  branchNameError,
  decideSwitch,
  dirtyPathsText,
  headDescription,
  parseBranchList,
  parsePorcelainPaths,
  switchBlocker,
} from './branches.ts';
import type { GitracError } from './errors.ts';

function state(overrides: Partial<BranchState> = {}): BranchState {
  return {
    current: 'main',
    detached: false,
    head: 'abc1234',
    branches: [
      { name: 'feature', current: false },
      { name: 'main', current: true },
      { name: 'wt', current: false, worktree: '/work/wt' },
    ],
    dirty: false,
    dirtyPaths: [],
    dirtyCount: 0,
    operation: null,
    ...overrides,
  };
}

function thrown(fn: () => unknown): GitracError {
  try {
    fn();
  } catch (err) {
    return err as GitracError;
  }
  throw new Error('expected an error');
}

describe('parseBranchList', () => {
  test('marks the current branch and branches in other worktrees, sorted', () => {
    const out = [
      ' \0refs/heads/zeta\0',
      '*\0refs/heads/main\0/work/main',
      ' \0refs/heads/agent-1\0/work/agent-1',
      '',
    ].join('\n');
    expect(parseBranchList(out, 'main')).toEqual([
      { name: 'agent-1', current: false, worktree: '/work/agent-1' },
      { name: 'main', current: true },
      { name: 'zeta', current: false },
    ]);
  });

  test('adds an unborn current branch', () => {
    expect(parseBranchList('', 'main')).toEqual([
      { name: 'main', current: true },
    ]);
  });

  test('a detached HEAD has no current branch', () => {
    const out = ' \0refs/heads/main\0\n';
    expect(parseBranchList(out, null)).toEqual([
      { name: 'main', current: false },
    ]);
  });
});

describe('parsePorcelainPaths', () => {
  test('lists paths and skips the source of a rename', () => {
    const out = [' M a.ts', 'R  new.ts', 'old.ts', 'A  b c.ts', ''].join('\0');
    expect(parsePorcelainPaths(out)).toEqual(['a.ts', 'new.ts', 'b c.ts']);
  });

  test('empty output is clean', () => {
    expect(parsePorcelainPaths('')).toEqual([]);
  });
});

describe('branchNameError', () => {
  test('accepts ordinary names', () => {
    expect(branchNameError('feature/x-1')).toBeNull();
  });

  test('refuses names that git could read as an option', () => {
    expect(branchNameError('--orphan')).toContain('must not start with "-"');
    expect(branchNameError('-c')).toContain('must not start with "-"');
  });

  test('refuses empty, non-string and control characters', () => {
    expect(branchNameError('')).toBe('Branch name is required');
    expect(branchNameError(undefined)).toBe('Branch name is required');
    expect(branchNameError(3)).toBe('Branch name is required');
    expect(branchNameError('a\nb')).toContain('control characters');
  });
});

describe('headDescription', () => {
  test('the branch, or detached at the short hash', () => {
    expect(headDescription({ current: 'main', head: 'abc' })).toBe('main');
    expect(headDescription({ current: null, head: 'abc1234' })).toBe(
      'detached at abc1234',
    );
    expect(headDescription({ current: null, head: '' })).toBe('detached HEAD');
  });
});

describe('switchBlocker', () => {
  test('null when clean', () => {
    expect(switchBlocker(state())).toBeNull();
  });

  test('names a few dirty paths', () => {
    const message = switchBlocker(
      state({
        dirty: true,
        dirtyPaths: ['a', 'b', 'c', 'd', 'e'],
        dirtyCount: 7,
      }),
    );
    expect(message).toContain('uncommitted changes to tracked files');
    expect(message).toContain('(a, b, c, d, e and 2 more)');
  });

  test('an operation in progress comes first', () => {
    const message = switchBlocker(
      state({ operation: 'merge', dirty: true, dirtyPaths: ['a'] }),
    );
    expect(message).toBe(
      'A merge is in progress; finish or abort it before switching branches.',
    );
  });
});

describe('dirtyPathsText', () => {
  test('lists all when few', () => {
    expect(dirtyPathsText(['a', 'b'], 2)).toBe('a, b');
  });
});

describe('branchBlocker', () => {
  test('another worktree, or no gitrac config', () => {
    expect(branchBlocker({ name: 'x', current: false })).toBeNull();
    expect(branchBlocker({ name: 'x', current: false, worktree: '/w/x' })).toBe(
      'Branch "x" is checked out in worktree /w/x.',
    );
    expect(
      branchBlocker({ name: 'x', current: false, uninitialized: true }),
    ).toContain('has no .issues/config.yaml');
  });
});

describe('decideSwitch', () => {
  test('switch to another local branch', () => {
    expect(decideSwitch(state(), 'feature')).toBe('switch');
  });

  test('the current branch is a no-op, even when dirty', () => {
    expect(
      decideSwitch(state({ dirty: true, dirtyPaths: ['a'] }), 'main'),
    ).toBe('noop');
  });

  test('unknown branch is invalid input', () => {
    const err = thrown(() => decideSwitch(state(), 'origin/feature'));
    expect(err.code).toBe('invalid_input');
    expect(err.message).toBe(
      'Unknown branch "origin/feature": not a local branch',
    );
  });

  test('a branch in another worktree is refused', () => {
    const err = thrown(() => decideSwitch(state(), 'wt'));
    expect(err.code).toBe('invalid_state');
    expect(err.details).toEqual({ branch: 'wt', worktree: '/work/wt' });
  });

  test('dirty tracked files are refused', () => {
    const err = thrown(() =>
      decideSwitch(
        state({ dirty: true, dirtyPaths: ['src/a.ts'], dirtyCount: 1 }),
        'feature',
      ),
    );
    expect(err.code).toBe('invalid_state');
    expect(err.message).toContain('src/a.ts');
    expect(err.details).toEqual({ paths: ['src/a.ts'] });
  });

  test('an operation in progress is refused', () => {
    const err = thrown(() =>
      decideSwitch(state({ operation: 'rebase' }), 'feature'),
    );
    expect(err.code).toBe('invalid_state');
    expect(err.details).toEqual({ operation: 'rebase' });
  });

  test('from a detached HEAD', () => {
    expect(
      decideSwitch(
        state({
          current: null,
          detached: true,
          branches: [{ name: 'main', current: false }],
        }),
        'main',
      ),
    ).toBe('switch');
  });
});
