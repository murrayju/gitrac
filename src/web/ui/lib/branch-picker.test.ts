import { describe, expect, test } from 'bun:test';
import type { BranchState } from '../../../core/branches.ts';
import { branchPickerView, switchPrompt } from './branch-picker.ts';

function state(overrides: Partial<BranchState> = {}): BranchState {
  return {
    current: 'main',
    detached: false,
    head: 'abc1234',
    branches: [
      { name: 'feature', current: false },
      { name: 'main', current: true },
      { name: 'agent-1', current: false, worktree: '/work/agent-1' },
      { name: 'gh-pages', current: false, uninitialized: true },
    ],
    dirty: false,
    dirtyPaths: [],
    dirtyCount: 0,
    operation: null,
    ...overrides,
  };
}

describe('branchPickerView', () => {
  test('shows the current branch, marked, and enables other branches', () => {
    const view = branchPickerView(state());
    expect(view.label).toBe('main');
    expect(view.value).toBe('main');
    expect(view.disabledReason).toBeNull();
    expect(view.onlyBranch).toBe(false);
    expect(view.options).toEqual([
      { value: 'feature', label: 'feature', disabled: false },
      { value: 'main', label: 'main (current)', disabled: false },
      {
        value: 'agent-1',
        label: 'agent-1 (in another worktree)',
        disabled: true,
        reason: 'Branch "agent-1" is checked out in worktree /work/agent-1.',
      },
      {
        value: 'gh-pages',
        label: 'gh-pages (no gitrac)',
        disabled: true,
        reason:
          'Branch "gh-pages" has no .issues/config.yaml (gitrac is not initialized there).',
      },
    ]);
  });

  test('a detached HEAD shows "detached at <sha>" as the selected placeholder', () => {
    const view = branchPickerView(
      state({
        current: null,
        detached: true,
        branches: [{ name: 'main', current: false }],
      }),
    );
    expect(view.label).toBe('detached at abc1234');
    expect(view.value).toBe('');
    expect(view.options[0]).toEqual({
      value: '',
      label: 'detached at abc1234',
      disabled: true,
    });
    expect(view.options[1]).toEqual({
      value: 'main',
      label: 'main',
      disabled: false,
    });
    expect(view.onlyBranch).toBe(false);
  });

  test('dirty tracked files disable the picker with the paths', () => {
    const view = branchPickerView(
      state({ dirty: true, dirtyPaths: ['src/a.ts'], dirtyCount: 1 }),
    );
    expect(view.disabledReason).toContain('uncommitted changes');
    expect(view.disabledReason).toContain('src/a.ts');
  });

  test('an operation in progress disables the picker', () => {
    const view = branchPickerView(state({ operation: 'rebase' }));
    expect(view.disabledReason).toBe(
      'A rebase is in progress; finish or abort it before switching branches.',
    );
  });

  test('no other usable branch', () => {
    const view = branchPickerView(
      state({
        branches: [
          { name: 'main', current: true },
          { name: 'agent-1', current: false, worktree: '/w' },
        ],
      }),
    );
    expect(view.onlyBranch).toBe(true);
  });
});

describe('switchPrompt', () => {
  test('names both sides', () => {
    expect(switchPrompt(state(), 'feature')).toBe(
      'Switch this worktree from main to branch "feature"? Open pages show the issues on "feature".',
    );
  });
});
