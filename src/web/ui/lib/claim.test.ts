import { describe, expect, test } from 'bun:test';
import { createDefaultConfig } from '../../../core/config.ts';
import { ApiError } from '../api.ts';
import { actingUser, claimActions, claimConflict } from './claim.ts';

const assignees = [
  { name: 'Ada', email: 'ada@example.com' },
  { name: 'Grace', email: 'grace@example.com' },
];
const SERVER = { name: 'Server', email: 'server@example.com' };
const GRACE = { name: 'Grace', email: 'grace@example.com' };
const config = createDefaultConfig();

describe('actingUser', () => {
  test('the picked assignee, with their email', () => {
    expect(actingUser('Grace', SERVER, assignees)).toEqual(GRACE);
  });

  test('the server identity when nothing (or a stale choice) is picked', () => {
    expect(actingUser('', SERVER, assignees)).toEqual(SERVER);
    expect(actingUser('Gone', SERVER, assignees)).toEqual(SERVER);
    expect(actingUser('', null, assignees)).toBeNull();
  });
});

describe('claimActions', () => {
  const open = { status: 'todo', assignee: '' };

  test('an unassigned open issue can be claimed, not released', () => {
    expect(claimActions(open, GRACE, config)).toEqual({
      claim: true,
      release: false,
    });
  });

  test('your own active claim can be released, not claimed again', () => {
    const mine = { status: 'in_progress', assignee: 'GRACE@example.com' };
    expect(claimActions(mine, GRACE, config)).toEqual({
      claim: false,
      release: true,
    });
  });

  test("someone else's claim shows both (the server asks before a takeover)", () => {
    const theirs = { status: 'in_progress', assignee: 'bob@example.com' };
    expect(claimActions(theirs, GRACE, config)).toEqual({
      claim: true,
      release: true,
    });
  });

  test('assigned to you but not active: Claim starts it', () => {
    const assigned = { status: 'todo', assignee: 'grace@example.com' };
    expect(claimActions(assigned, GRACE, config)).toEqual({
      claim: true,
      release: true,
    });
  });

  test('a claim elsewhere counts as the assignee', () => {
    const where = {
      ref: 'agent-1',
      assignee: 'grace@example.com',
      updated: '2026-01-02T00:00:00Z',
    };
    expect(
      claimActions({ ...open, claimedElsewhere: where }, GRACE, config),
    ).toEqual({ claim: false, release: true });
    expect(
      claimActions(
        { ...open, claimedElsewhere: { ...where, assignee: 'bob' } },
        GRACE,
        config,
      ),
    ).toEqual({ claim: true, release: true });
  });

  test('uses the configured active status', () => {
    const custom = {
      ...config,
      statuses: [
        { name: 'open', closed: false },
        { name: 'doing', closed: false },
        { name: 'shipped', closed: true },
      ],
      activeStatus: 'doing',
    };
    const mine = { status: 'doing', assignee: 'grace@example.com' };
    expect(claimActions(mine, GRACE, custom).claim).toBe(false);
    const done = { status: 'shipped', assignee: '' };
    expect(claimActions(done, GRACE, custom)).toEqual({
      claim: false,
      release: false,
    });
  });

  test('nothing for a closed issue, a close elsewhere, or before load', () => {
    const none = { claim: false, release: false };
    expect(
      claimActions({ status: 'done', assignee: '' }, GRACE, config),
    ).toEqual(none);
    const closedElsewhere = {
      ref: 'agent-1',
      status: 'done',
      updated: '2026-01-02T00:00:00Z',
    };
    expect(claimActions({ ...open, closedElsewhere }, GRACE, config)).toEqual(
      none,
    );
    expect(claimActions(open, null, config)).toEqual(none);
    expect(claimActions(open, GRACE, null)).toEqual(none);
  });
});

describe('claimConflict', () => {
  const body = (value: unknown) => JSON.stringify(value);

  test('already_claimed can be forced', () => {
    const err = new ApiError(
      409,
      body({
        error: 'Issue #1 is already claimed by bob (in_progress).',
        code: 'already_claimed',
        assignee: 'bob',
      }),
    );
    expect(claimConflict(err)).toEqual({
      code: 'already_claimed',
      message: 'Issue #1 is already claimed by bob (in_progress).',
      canForce: true,
    });
  });

  test('issue_closed cannot', () => {
    const err = new ApiError(
      409,
      body({ error: 'Issue #1 is closed (done).', code: 'issue_closed' }),
    );
    expect(claimConflict(err)?.canForce).toBe(false);
  });

  test('other errors are not claim conflicts', () => {
    expect(claimConflict(new ApiError(400, body({ error: 'x' })))).toBeNull();
    expect(
      claimConflict(
        new ApiError(409, body({ error: 'x', code: 'invalid_state' })),
      ),
    ).toBeNull();
    expect(claimConflict(new ApiError(409, 'not json'))).toBeNull();
    expect(claimConflict(new Error('x'))).toBeNull();
  });
});
