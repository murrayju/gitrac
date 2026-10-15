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

describe('decideClaim with versions elsewhere (#56)', () => {
  const at = (t: number) => `2026-01-0${t}T00:00:00Z`;
  const todo = { status: 'todo' as const, assignee: '', updated: at(2) };
  const bobsClaim = {
    ref: 'agent-1',
    worktree: '/wt/agent-1',
    status: 'in_progress' as const,
    assignee: bob.email,
    updated: at(3),
  };

  test('refuses a newer claim by someone else, saying where', () => {
    expect(decideClaim(todo, alice, { elsewhere: [bobsClaim] })).toEqual({
      action: 'already-claimed',
      assignee: bob.email,
      elsewhere: {
        ref: 'agent-1',
        worktree: '/wt/agent-1',
        assignee: bob.email,
        updated: at(3),
      },
    });
  });

  test('force takes it over', () => {
    expect(
      decideClaim(todo, alice, { elsewhere: [bobsClaim], force: true }),
    ).toEqual({ action: 'claim', reopen: false });
  });

  test('an older claim elsewhere is superseded by the local version', () => {
    expect(
      decideClaim({ ...todo, updated: at(4) }, alice, {
        elsewhere: [bobsClaim],
      }),
    ).toEqual({ action: 'claim', reopen: false });
  });

  test('a newer unclaim elsewhere supersedes a local claim', () => {
    const local = {
      status: 'in_progress' as const,
      assignee: bob.email,
      updated: at(3),
    };
    const released = {
      ...bobsClaim,
      status: 'todo' as const,
      assignee: '',
      updated: at(4),
    };
    expect(decideClaim(local, alice, { elsewhere: [released] })).toEqual({
      action: 'claim',
      reopen: false,
    });
  });

  test('my own claim elsewhere: claimed here too (not a no-op)', () => {
    const mine = { ...bobsClaim, assignee: alice.email };
    expect(decideClaim(todo, alice, { elsewhere: [mine] })).toEqual({
      action: 'claim',
      reopen: false,
    });
    expect(
      decideClaim(
        { status: 'in_progress', assignee: alice.email, updated: at(2) },
        alice,
        { elsewhere: [mine] },
      ),
    ).toEqual({ action: 'claim', reopen: false });
    // With nothing newer elsewhere, my own local claim is still a no-op.
    expect(
      decideClaim(
        { status: 'in_progress', assignee: alice.email, updated: at(4) },
        alice,
        { elsewhere: [mine] },
      ),
    ).toEqual({ action: 'noop' });
  });

  test('a closed local issue is still refused as closed', () => {
    expect(
      decideClaim({ ...todo, status: 'done' }, alice, {
        elsewhere: [bobsClaim],
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
