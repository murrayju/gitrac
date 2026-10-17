import { describe, expect, test } from 'bun:test';
import {
  claimAssignee,
  decideClaim,
  decideEdit,
  decideReview,
  decideUnclaim,
  isAssignedTo,
} from './claim.ts';
import { createDefaultConfig } from './config.ts';

const CONFIG = createDefaultConfig();

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
    expect(
      decideClaim({ status: 'todo', assignee: '' }, alice, CONFIG),
    ).toEqual({
      action: 'claim',
      reopen: false,
    });
  });

  test('in_progress issue owned by someone else is refused', () => {
    expect(
      decideClaim(
        { status: 'in_progress', assignee: bob.email },
        alice,
        CONFIG,
      ),
    ).toEqual({ action: 'already-claimed', assignee: bob.email });
  });

  test('--force takes over an in_progress issue owned by someone else', () => {
    expect(
      decideClaim(
        { status: 'in_progress', assignee: bob.email },
        alice,
        CONFIG,
        {
          force: true,
        },
      ),
    ).toEqual({ action: 'claim', reopen: false });
  });

  test('in_progress issue already owned by the user is a no-op', () => {
    expect(
      decideClaim(
        { status: 'in_progress', assignee: alice.email },
        alice,
        CONFIG,
      ),
    ).toEqual({ action: 'noop' });
    expect(
      decideClaim(
        { status: 'in_progress', assignee: 'Alice' },
        aliceNoEmail,
        CONFIG,
      ),
    ).toEqual({ action: 'noop' });
  });

  test('not-yet-started issue assigned to the user is claimed (set in_progress)', () => {
    expect(
      decideClaim({ status: 'todo', assignee: alice.email }, alice, CONFIG),
    ).toEqual({ action: 'claim', reopen: false });
  });

  test('in_progress but unassigned is claimable', () => {
    expect(
      decideClaim({ status: 'in_progress', assignee: '' }, alice, CONFIG),
    ).toEqual({ action: 'claim', reopen: false });
  });

  test('closed issue requires --force', () => {
    for (const status of ['done', 'cancelled'] as const) {
      expect(decideClaim({ status, assignee: '' }, alice, CONFIG)).toEqual({
        action: 'closed',
      });
      expect(
        decideClaim({ status, assignee: bob.email }, alice, CONFIG, {
          force: true,
        }),
      ).toEqual({ action: 'claim', reopen: true });
    }
    // The status decides, not the directory (#97): an open-status file
    // left in closed/ by a merge can be claimed (claimIssue moves it).
    expect(
      decideClaim({ status: 'todo', assignee: '' }, alice, CONFIG),
    ).toEqual({
      action: 'claim',
      reopen: false,
    });
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
    expect(
      decideClaim(todo, alice, CONFIG, { elsewhere: [bobsClaim] }),
    ).toEqual({
      action: 'already-claimed',
      assignee: bob.email,
      elsewhere: {
        ref: 'agent-1',
        worktree: '/wt/agent-1',
        assignee: bob.email,
        status: 'in_progress',
        updated: at(3),
      },
    });
  });

  test('force takes it over', () => {
    expect(
      decideClaim(todo, alice, CONFIG, { elsewhere: [bobsClaim], force: true }),
    ).toEqual({ action: 'claim', reopen: false });
  });

  test('an older claim elsewhere is superseded by the local version', () => {
    expect(
      decideClaim({ ...todo, updated: at(4) }, alice, CONFIG, {
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
    expect(
      decideClaim(local, alice, CONFIG, { elsewhere: [released] }),
    ).toEqual({
      action: 'claim',
      reopen: false,
    });
  });

  test('my own claim elsewhere: claimed here too (not a no-op)', () => {
    const mine = { ...bobsClaim, assignee: alice.email };
    const heldElsewhere = {
      ref: 'agent-1',
      worktree: '/wt/agent-1',
      assignee: alice.email,
      status: 'in_progress',
      updated: at(3),
    };
    expect(decideClaim(todo, alice, CONFIG, { elsewhere: [mine] })).toEqual({
      action: 'claim',
      reopen: false,
      heldElsewhere,
    });
    expect(
      decideClaim(
        { status: 'in_progress', assignee: alice.email, updated: at(2) },
        alice,
        CONFIG,
        { elsewhere: [mine] },
      ),
    ).toEqual({ action: 'claim', reopen: false, heldElsewhere });
    // With nothing newer elsewhere, my own local claim is still a no-op.
    expect(
      decideClaim(
        { status: 'in_progress', assignee: alice.email, updated: at(4) },
        alice,
        CONFIG,
        { elsewhere: [mine] },
      ),
    ).toEqual({ action: 'noop' });
  });

  test('a newer close elsewhere is refused as closed, saying where (#93)', () => {
    const done = { ...bobsClaim, status: 'done' as const, updated: at(4) };
    const where = {
      ref: 'agent-1',
      worktree: '/wt/agent-1',
      status: 'done',
      updated: at(4),
    };
    expect(decideClaim(todo, alice, CONFIG, { elsewhere: [done] })).toEqual({
      action: 'closed',
      elsewhere: where,
    });
    // Also when the local copy is my own claim (the agent closed it later).
    expect(
      decideClaim(
        { status: 'in_progress', assignee: alice.email, updated: at(3) },
        alice,
        CONFIG,
        { elsewhere: [{ ...done, assignee: alice.email }] },
      ),
    ).toMatchObject({ action: 'closed', elsewhere: { status: 'done' } });
    // Committed on a branch (no worktree): no `worktree` key.
    const { worktree: _, ...onBranch } = done;
    const { worktree: __, ...whereOnBranch } = where;
    expect(decideClaim(todo, alice, CONFIG, { elsewhere: [onBranch] })).toEqual(
      { action: 'closed', elsewhere: whereOnBranch },
    );
  });

  test('force claims an issue closed elsewhere (no reopen needed here)', () => {
    const done = { ...bobsClaim, status: 'done' as const, updated: at(4) };
    expect(
      decideClaim(todo, alice, CONFIG, { elsewhere: [done], force: true }),
    ).toEqual({ action: 'claim', reopen: false });
  });

  test('an older close elsewhere is superseded by the local version', () => {
    const done = { ...bobsClaim, status: 'done' as const, updated: at(1) };
    expect(decideClaim(todo, alice, CONFIG, { elsewhere: [done] })).toEqual({
      action: 'claim',
      reopen: false,
    });
  });

  test('a closed local issue is still refused as closed', () => {
    expect(
      decideClaim({ ...todo, status: 'done' }, alice, CONFIG, {
        elsewhere: [bobsClaim],
      }),
    ).toEqual({ action: 'closed' });
  });
});

describe('decideUnclaim', () => {
  test('own issue is released', () => {
    expect(
      decideUnclaim(
        { status: 'in_progress', assignee: alice.email },
        alice,
        CONFIG,
      ),
    ).toEqual({ action: 'unclaim', status: 'todo' });
  });

  test("someone else's issue requires --force", () => {
    expect(
      decideUnclaim(
        { status: 'in_progress', assignee: bob.email },
        alice,
        CONFIG,
      ),
    ).toEqual({ action: 'not-yours', assignee: bob.email });
    expect(
      decideUnclaim(
        { status: 'in_progress', assignee: bob.email },
        alice,
        CONFIG,
        {
          force: true,
        },
      ),
    ).toEqual({ action: 'unclaim', status: 'todo' });
  });

  test('unassigned issue is a no-op', () => {
    expect(
      decideUnclaim({ status: 'todo', assignee: '' }, alice, CONFIG),
    ).toEqual({
      action: 'noop',
    });
  });

  test('closed issue is refused, even with --force', () => {
    expect(
      decideUnclaim({ status: 'done', assignee: alice.email }, alice, CONFIG, {
        force: true,
      }),
    ).toEqual({ action: 'closed', status: 'done' });
  });

  test('other statuses are kept', () => {
    expect(
      decideUnclaim(
        { status: 'backlog', assignee: alice.email },
        alice,
        CONFIG,
      ),
    ).toEqual({ action: 'unclaim', status: 'backlog' });
  });
});

describe('configured active status (#57)', () => {
  const custom = {
    ...CONFIG,
    statuses: [
      { name: 'open', closed: false },
      { name: 'doing', closed: false },
      { name: 'in_progress', closed: false },
      { name: 'shipped', closed: true },
    ],
    defaultStatus: 'open',
    activeStatus: 'doing',
  };

  test('only the active status counts as claimed', () => {
    expect(
      decideClaim({ status: 'doing', assignee: bob.email }, alice, custom),
    ).toEqual({ action: 'already-claimed', assignee: bob.email });
    expect(
      decideClaim(
        { status: 'in_progress', assignee: bob.email },
        alice,
        custom,
      ),
    ).toEqual({ action: 'claim', reopen: false });
    expect(
      decideClaim({ status: 'doing', assignee: alice.email }, alice, custom),
    ).toEqual({ action: 'noop' });
  });

  test('custom closed statuses are closed', () => {
    expect(
      decideClaim({ status: 'shipped', assignee: '' }, alice, custom),
    ).toEqual({ action: 'closed' });
    expect(
      decideUnclaim(
        { status: 'shipped', assignee: alice.email },
        alice,
        custom,
      ),
    ).toEqual({ action: 'closed', status: 'shipped' });
  });

  test('a custom closed status elsewhere refuses the claim (#93)', () => {
    const shipped = {
      ref: 'agent-1',
      status: 'shipped',
      assignee: '',
      updated: '2026-01-05T00:00:00Z',
    };
    const local = {
      status: 'open',
      assignee: '',
      updated: '2026-01-02T00:00:00Z',
    };
    expect(
      decideClaim(local, alice, custom, { elsewhere: [shipped] }),
    ).toMatchObject({ action: 'closed', elsewhere: { status: 'shipped' } });
    // An open status elsewhere doesn't block the claim.
    expect(
      decideClaim(local, alice, custom, {
        elsewhere: [{ ...shipped, status: 'open' }],
      }),
    ).toEqual({ action: 'claim', reopen: false });
  });
});

describe('decideUnclaim with versions elsewhere (#65)', () => {
  const at = (t: number) => `2026-01-0${t}T00:00:00Z`;
  const todo = { status: 'todo' as const, assignee: '', updated: at(2) };
  const claimBy = (assignee: string, updated = at(3)) => ({
    ref: 'agent-1',
    worktree: '/wt/agent-1',
    status: 'in_progress' as const,
    assignee,
    updated,
  });
  const where = (assignee: string) => ({
    ref: 'agent-1',
    worktree: '/wt/agent-1',
    assignee,
    status: 'in_progress',
    updated: at(3),
  });

  test('my newer claim elsewhere is released (back to the unclaim status)', () => {
    expect(
      decideUnclaim(todo, alice, CONFIG, {
        elsewhere: [claimBy(alice.email)],
      }),
    ).toEqual({
      action: 'unclaim',
      status: 'todo',
      elsewhere: where(alice.email),
    });
  });

  test("someone else's newer claim elsewhere requires force", () => {
    const elsewhere = [claimBy(bob.email)];
    expect(decideUnclaim(todo, alice, CONFIG, { elsewhere })).toEqual({
      action: 'not-yours',
      assignee: bob.email,
      elsewhere: where(bob.email),
    });
    expect(
      decideUnclaim(todo, alice, CONFIG, { elsewhere, force: true }),
    ).toEqual({
      action: 'unclaim',
      status: 'todo',
      elsewhere: where(bob.email),
    });
  });

  test('a newer release elsewhere makes it a no-op, even if assigned here', () => {
    const local = {
      status: 'in_progress' as const,
      assignee: bob.email,
      updated: at(2),
    };
    expect(
      decideUnclaim(local, alice, CONFIG, {
        elsewhere: [{ ...claimBy(''), status: 'todo' }],
      }),
    ).toEqual({ action: 'noop' });
  });

  test('an older claim elsewhere is superseded by the local version', () => {
    expect(
      decideUnclaim({ ...todo, updated: at(4) }, alice, CONFIG, {
        elsewhere: [claimBy(bob.email)],
      }),
    ).toEqual({ action: 'noop' });
    expect(
      decideUnclaim(
        { status: 'in_progress', assignee: alice.email, updated: at(4) },
        alice,
        CONFIG,
        { elsewhere: [claimBy(bob.email)] },
      ),
    ).toEqual({ action: 'unclaim', status: 'todo' });
  });

  test("the effective version's status is kept unless it is the active one", () => {
    expect(
      decideUnclaim(
        { status: 'in_progress', assignee: '', updated: at(2) },
        alice,
        CONFIG,
        {
          elsewhere: [{ ...claimBy(alice.email), status: 'backlog' }],
        },
      ),
    ).toEqual({
      action: 'unclaim',
      status: 'backlog',
      elsewhere: { ...where(alice.email), status: 'backlog' },
    });
  });

  test('closed in a newer version elsewhere is refused (it would reopen it)', () => {
    const closed = { ...claimBy(alice.email), status: 'done' as const };
    expect(
      decideUnclaim({ ...todo, assignee: alice.email }, alice, CONFIG, {
        elsewhere: [closed],
        force: true,
      }),
    ).toEqual({ action: 'closed', status: 'done', elsewhere: closed });
  });
});

/** Regression tests for #105: a review status keeps the issue held. */
describe('review status (#105)', () => {
  const REVIEW = {
    ...CONFIG,
    statuses: [...CONFIG.statuses, { name: 'review', closed: false }],
    reviewStatus: 'review',
  };
  const at = (t: number) => `2026-01-0${t}T00:00:00Z`;
  const reviewBy = (assignee: string, updated = at(3)) => ({
    ref: 'agent-1',
    worktree: '/wt/agent-1',
    status: 'review',
    assignee,
    updated,
  });
  const where = (assignee: string, status = 'review') => ({
    ref: 'agent-1',
    worktree: '/wt/agent-1',
    assignee,
    status,
    updated: at(3),
  });
  const todo = { status: 'todo', assignee: '', updated: at(2) };

  test("someone else's issue in review is claimed: refused unless force", () => {
    const issue = { status: 'review', assignee: bob.email };
    expect(decideClaim(issue, alice, REVIEW)).toEqual({
      action: 'already-claimed',
      assignee: bob.email,
    });
    expect(decideClaim(issue, alice, REVIEW, { force: true })).toEqual({
      action: 'claim',
      reopen: false,
    });
    // Without a review status, a status named review is not held.
    expect(decideClaim(issue, alice, CONFIG)).toEqual({
      action: 'claim',
      reopen: false,
    });
  });

  test('my own issue in review is claimed back to the active status (rework)', () => {
    expect(
      decideClaim({ status: 'review', assignee: alice.email }, alice, REVIEW),
    ).toEqual({ action: 'claim', reopen: false });
  });

  test("someone else's review elsewhere is claimed elsewhere", () => {
    expect(
      decideClaim(todo, alice, REVIEW, { elsewhere: [reviewBy(bob.email)] }),
    ).toEqual({
      action: 'already-claimed',
      assignee: bob.email,
      elsewhere: where(bob.email),
    });
  });

  test('unclaim moves the review status back to the unclaim status', () => {
    expect(
      decideUnclaim({ status: 'review', assignee: alice.email }, alice, REVIEW),
    ).toEqual({ action: 'unclaim', status: 'todo' });
    expect(
      decideUnclaim(todo, alice, REVIEW, {
        elsewhere: [reviewBy(bob.email)],
        force: true,
      }),
    ).toEqual({
      action: 'unclaim',
      status: 'todo',
      elsewhere: where(bob.email),
    });
  });

  describe('decideReview', () => {
    const mine = { status: 'in_progress', assignee: alice.email };

    test('my claimed issue goes to review, keeping the assignee', () => {
      expect(decideReview(mine, alice, REVIEW)).toEqual({
        action: 'review',
        status: 'review',
        assignee: alice.email,
      });
    });

    test('no review status configured is refused', () => {
      expect(decideReview(mine, alice, CONFIG)).toEqual({
        action: 'no-review-status',
      });
    });

    test('an unclaimed issue is refused', () => {
      expect(decideReview(todo, alice, REVIEW)).toEqual({
        action: 'not-claimed',
        status: 'todo',
      });
      expect(
        decideReview({ status: 'in_progress', assignee: '' }, alice, REVIEW),
      ).toEqual({ action: 'not-claimed', status: 'in_progress' });
    });

    test("someone else's claim needs force; their assignee is kept", () => {
      const theirs = { status: 'in_progress', assignee: bob.email };
      expect(decideReview(theirs, alice, REVIEW)).toEqual({
        action: 'not-yours',
        assignee: bob.email,
      });
      expect(decideReview(theirs, alice, REVIEW, { force: true })).toEqual({
        action: 'review',
        status: 'review',
        assignee: bob.email,
      });
    });

    test('already in review is a no-op', () => {
      expect(
        decideReview(
          { status: 'review', assignee: alice.email },
          alice,
          REVIEW,
        ),
      ).toEqual({ action: 'noop' });
    });

    test('closed here or elsewhere is refused', () => {
      expect(
        decideReview({ status: 'done', assignee: alice.email }, alice, REVIEW),
      ).toEqual({ action: 'closed', status: 'done' });
      expect(
        decideReview({ ...mine, updated: at(2) }, alice, REVIEW, {
          elsewhere: [{ ...reviewBy(alice.email), status: 'done' }],
        }),
      ).toEqual({
        action: 'closed',
        status: 'done',
        elsewhere: {
          ref: 'agent-1',
          worktree: '/wt/agent-1',
          status: 'done',
          updated: at(3),
        },
      });
    });

    test('my claim elsewhere is handed off by a newer local write', () => {
      expect(
        decideReview(todo, alice, REVIEW, {
          elsewhere: [{ ...reviewBy(alice.email), status: 'in_progress' }],
        }),
      ).toEqual({
        action: 'review',
        status: 'review',
        assignee: alice.email,
        elsewhere: where(alice.email, 'in_progress'),
      });
    });
  });
});

/** Regression tests for #108: an edit must not overwrite a claim. */
describe('decideEdit', () => {
  const at = (t: number) => `2026-01-0${t}T00:00:00Z`;
  const bobs = {
    status: 'in_progress',
    assignee: bob.email,
    updated: at(2),
  };
  const todo = { status: 'todo', assignee: '', updated: at(2) };
  const bobsClaim = {
    ref: 'agent-1',
    worktree: '/wt/agent-1',
    status: 'in_progress',
    assignee: bob.email,
    updated: at(3),
  };

  test("a status or assignee change of someone else's claim is refused", () => {
    expect(decideEdit(bobs, true, alice, CONFIG)).toEqual({
      action: 'already-claimed',
      assignee: bob.email,
    });
  });

  test('force, the holder, or an edit of other fields is allowed', () => {
    expect(decideEdit(bobs, true, alice, CONFIG, { force: true })).toEqual({
      action: 'edit',
    });
    expect(decideEdit(bobs, true, bob, CONFIG)).toEqual({ action: 'edit' });
    expect(decideEdit(bobs, false, alice, CONFIG)).toEqual({ action: 'edit' });
  });

  test('an issue that is not held, or held by no one, can be changed', () => {
    expect(decideEdit(todo, true, alice, CONFIG)).toEqual({ action: 'edit' });
    expect(
      decideEdit({ ...bobs, status: 'todo' }, true, alice, CONFIG),
    ).toEqual({ action: 'edit' });
    expect(decideEdit({ ...bobs, assignee: ' ' }, true, alice, CONFIG)).toEqual(
      { action: 'edit' },
    );
  });

  test('a newer claim elsewhere is refused, saying where', () => {
    expect(
      decideEdit(todo, true, alice, CONFIG, { elsewhere: [bobsClaim] }),
    ).toEqual({
      action: 'already-claimed',
      assignee: bob.email,
      elsewhere: {
        ref: 'agent-1',
        worktree: '/wt/agent-1',
        assignee: bob.email,
        status: 'in_progress',
        updated: at(3),
      },
    });
    expect(
      decideEdit(todo, true, bob, CONFIG, { elsewhere: [bobsClaim] }),
    ).toEqual({ action: 'edit' });
  });

  test('an older claim elsewhere is superseded by the local version', () => {
    expect(
      decideEdit({ ...todo, updated: at(4) }, true, alice, CONFIG, {
        elsewhere: [bobsClaim],
      }),
    ).toEqual({ action: 'edit' });
  });

  test('the review status is held too', () => {
    const REVIEW = {
      ...CONFIG,
      statuses: [...CONFIG.statuses, { name: 'review', closed: false }],
      reviewStatus: 'review',
    };
    expect(
      decideEdit({ ...bobs, status: 'review' }, true, alice, REVIEW).action,
    ).toBe('already-claimed');
  });
});
