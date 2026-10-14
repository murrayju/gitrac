import { describe, expect, test } from 'bun:test';
import {
  claimAssignee,
  decideClaim,
  decideUnclaim,
  isAssignedTo,
} from './claim.ts';

const alice = { name: 'Alice', email: 'alice@example.com' };
const bob = { name: 'Bob', email: 'bob@example.com' };
const aliceNoEmail = { name: 'Alice', email: '' };

describe('claimAssignee', () => {
  test('prefers email, falls back to name', () => {
    expect(claimAssignee(alice)).toBe('alice@example.com');
    expect(claimAssignee(aliceNoEmail)).toBe('Alice');
  });
});

describe('isAssignedTo', () => {
  test('matches email or name case-insensitively', () => {
    expect(isAssignedTo('ALICE@example.com', alice)).toBe(true);
    expect(isAssignedTo('alice', alice)).toBe(true);
    expect(isAssignedTo('Alice', aliceNoEmail)).toBe(true);
    expect(isAssignedTo('bob@example.com', alice)).toBe(false);
  });

  test('empty assignee or empty identity never matches', () => {
    expect(isAssignedTo('', alice)).toBe(false);
    expect(isAssignedTo('  ', aliceNoEmail)).toBe(false);
    expect(isAssignedTo('x', { name: '', email: '' })).toBe(false);
  });
});

describe('decideClaim', () => {
  test('unassigned open issue is claimed', () => {
    expect(decideClaim({ status: 'todo', assignee: '' }, alice)).toEqual({
      action: 'claim',
      reopen: false,
    });
  });

  test('in_progress issue owned by someone else is refused', () => {
    expect(
      decideClaim({ status: 'in_progress', assignee: bob.email }, alice),
    ).toEqual({ action: 'already-claimed', assignee: bob.email });
  });

  test('--force takes over an in_progress issue owned by someone else', () => {
    expect(
      decideClaim({ status: 'in_progress', assignee: bob.email }, alice, {
        force: true,
      }),
    ).toEqual({ action: 'claim', reopen: false });
  });

  test('in_progress issue already owned by the user is a no-op', () => {
    expect(
      decideClaim({ status: 'in_progress', assignee: alice.email }, alice),
    ).toEqual({ action: 'noop' });
    expect(
      decideClaim({ status: 'in_progress', assignee: 'Alice' }, aliceNoEmail),
    ).toEqual({ action: 'noop' });
  });

  test('not-yet-started issue assigned to the user is claimed (set in_progress)', () => {
    expect(
      decideClaim({ status: 'todo', assignee: alice.email }, alice),
    ).toEqual({ action: 'claim', reopen: false });
  });

  test('in_progress but unassigned is claimable', () => {
    expect(decideClaim({ status: 'in_progress', assignee: '' }, alice)).toEqual(
      { action: 'claim', reopen: false },
    );
  });

  test('closed issue requires --force', () => {
    for (const status of ['done', 'cancelled'] as const) {
      expect(decideClaim({ status, assignee: '' }, alice)).toEqual({
        action: 'closed',
      });
      expect(
        decideClaim({ status, assignee: bob.email }, alice, { force: true }),
      ).toEqual({ action: 'claim', reopen: true });
    }
    // Located in closed/ even if the status says otherwise
    expect(
      decideClaim({ status: 'todo', assignee: '' }, alice, {
        inClosedDir: true,
      }),
    ).toEqual({ action: 'closed' });
  });
});

describe('decideUnclaim', () => {
  test('own issue is released', () => {
    expect(
      decideUnclaim({ status: 'in_progress', assignee: alice.email }, alice),
    ).toEqual({ action: 'unclaim' });
  });

  test("someone else's issue requires --force", () => {
    expect(
      decideUnclaim({ status: 'in_progress', assignee: bob.email }, alice),
    ).toEqual({ action: 'not-yours', assignee: bob.email });
    expect(
      decideUnclaim({ status: 'in_progress', assignee: bob.email }, alice, {
        force: true,
      }),
    ).toEqual({ action: 'unclaim' });
  });

  test('unassigned issue is a no-op', () => {
    expect(decideUnclaim({ status: 'todo', assignee: '' }, alice)).toEqual({
      action: 'noop',
    });
  });

  test('closed issue is refused, even with --force', () => {
    expect(
      decideUnclaim({ status: 'done', assignee: alice.email }, alice, {
        force: true,
      }),
    ).toEqual({ action: 'closed' });
  });
});
