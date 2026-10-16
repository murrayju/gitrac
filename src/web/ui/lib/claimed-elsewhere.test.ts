import { describe, expect, test } from 'bun:test';
import {
  fullClaimText,
  fullCloseText,
  shortClaimText,
  shortCloseText,
  worktreeName,
} from './claimed-elsewhere.ts';

/** Regression tests for #66: wording of the claimed-elsewhere indicator. */

const base = { assignee: 'bob@example.com', updated: '2026-01-02T00:00:00Z' };

describe('claimed-elsewhere wording', () => {
  test('in another worktree', () => {
    const claim = { ...base, ref: 'agent-1', worktree: '/work/wt-1' };
    expect(shortClaimText(claim, 'Bob')).toBe('claimed by Bob in wt-1');
    expect(fullClaimText(claim, 'Bob')).toBe(
      'Claimed by Bob in worktree /work/wt-1 (branch agent-1)',
    );
  });

  test('in a detached worktree', () => {
    const claim = { ...base, ref: 'HEAD', worktree: '/work/wt-2/' };
    expect(shortClaimText(claim, 'Bob')).toBe('claimed by Bob in wt-2');
    expect(fullClaimText(claim, 'Bob')).toBe(
      'Claimed by Bob in worktree /work/wt-2/ (detached HEAD)',
    );
  });

  test('on a branch', () => {
    const claim = { ...base, ref: 'origin/agent-1' };
    expect(shortClaimText(claim, 'Bob')).toBe(
      'claimed by Bob on origin/agent-1',
    );
    expect(fullClaimText(claim, 'Bob')).toBe(
      'Claimed by Bob on branch origin/agent-1',
    );
  });

  test('worktree names', () => {
    expect(worktreeName('C:\\work\\wt-3')).toBe('wt-3');
    expect(worktreeName('/')).toBe('/');
  });
});

describe('closed-elsewhere wording (#93)', () => {
  const closed = { ref: 'agent-1', status: 'done', updated: base.updated };

  test('in another worktree', () => {
    const where = { ...closed, worktree: '/work/wt-1' };
    expect(shortCloseText(where, 'Done')).toBe('Done in wt-1');
    expect(fullCloseText(where, 'Done')).toBe(
      'Closed (Done) in worktree /work/wt-1 (branch agent-1)',
    );
  });

  test('on a branch', () => {
    expect(shortCloseText(closed, 'Done')).toBe('Done on agent-1');
    expect(fullCloseText(closed, 'Done')).toBe(
      'Closed (Done) on branch agent-1',
    );
  });
});
