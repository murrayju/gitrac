import { describe, expect, test } from 'bun:test';
import { createDefaultConfig } from '../core/config.ts';
import type { IssueStateElsewhere } from '../core/elsewhere.ts';
import type { Issue } from '../core/types.ts';
import { ELSEWHERE_CACHE_TTL_MS, ElsewhereCache } from './elsewhere-cache.ts';

/** Regression tests for #66: the web server's cached cross-worktree scan. */

type States = Map<number, IssueStateElsewhere[]>;

const CLAIM: IssueStateElsewhere = {
  ref: 'agent-1',
  worktree: '/tmp/agent-1',
  status: 'in_progress',
  assignee: 'bob@example.com',
  updated: '2026-01-02T00:00:00Z',
};

function issue(id: number): Issue {
  return {
    id,
    title: `Issue ${id}`,
    status: 'todo',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2026-01-01T00:00:00Z',
    createdBy: 'tester',
    updated: '2026-01-01T00:00:00Z',
    description: '',
    comments: [],
  };
}

/** A cache over a fake scan, with a controllable clock and change counter. */
function setup(ttlMs?: number) {
  const clock = { now: 1_000_000, generation: 0, scans: 0 };
  let next: () => Promise<States> = async () => new Map([[1, [CLAIM]]]);
  const cache = new ElsewhereCache('/repo', {
    ttlMs,
    now: () => clock.now,
    generation: () => clock.generation,
    scan: (dir) => {
      expect(dir).toBe('/repo');
      clock.scans++;
      return next();
    },
  });
  return {
    cache,
    clock,
    setScan(fn: () => Promise<States>) {
      next = fn;
    },
  };
}

describe('ElsewhereCache', () => {
  test('reuses one scan within the TTL', async () => {
    const { cache, clock } = setup();
    await cache.states();
    clock.now += ELSEWHERE_CACHE_TTL_MS - 1;
    await cache.states();
    expect(clock.scans).toBe(1);
  });

  test('rescans once the TTL has passed', async () => {
    const { cache, clock } = setup(1000);
    await cache.states();
    clock.now += 1000;
    await cache.states();
    expect(clock.scans).toBe(2);
  });

  test("rescans as soon as this worktree's files change (watcher)", async () => {
    const { cache, clock } = setup();
    await cache.states();
    clock.generation++;
    await cache.states();
    await cache.states();
    expect(clock.scans).toBe(2);
  });

  test('invalidate() drops the cached scan', async () => {
    const { cache, clock } = setup();
    await cache.states();
    cache.invalidate();
    await cache.states();
    expect(clock.scans).toBe(2);
  });

  test('concurrent callers share an in-flight scan', async () => {
    const { cache, clock, setScan } = setup();
    let release: (states: States) => void = () => {};
    setScan(() => new Promise<States>((r) => (release = r)));
    const a = cache.states();
    const b = cache.states();
    release(new Map([[1, [CLAIM]]]));
    expect(await a).toBe(await b);
    expect(clock.scans).toBe(1);
  });

  test('a failed scan yields no states and is not cached', async () => {
    const { cache, clock, setScan } = setup();
    setScan(() => Promise.reject(new Error('boom')));
    expect((await cache.states()).size).toBe(0);
    setScan(async () => new Map([[1, [CLAIM]]]));
    expect((await cache.states()).size).toBe(1);
    expect(clock.scans).toBe(2);
  });

  test('marks() applies the claimedElsewhere rules to the cached scan', async () => {
    const { cache, clock } = setup();
    const config = createDefaultConfig();
    const marks = await cache.marks([issue(1), issue(2)], config);
    expect([...marks.keys()]).toEqual([1]);
    expect(marks.get(1)).toEqual({
      claimedElsewhere: {
        ref: 'agent-1',
        worktree: '/tmp/agent-1',
        assignee: 'bob@example.com',
        updated: '2026-01-02T00:00:00Z',
      },
    });
    // A newer local version supersedes the claim elsewhere.
    const newer = { ...issue(1), updated: '2026-01-03T00:00:00Z' };
    expect((await cache.marks([newer], config)).size).toBe(0);
    // No issues: no scan needed.
    expect((await cache.marks([], config)).size).toBe(0);
    expect(clock.scans).toBe(1);
  });

  test('marks() reports a newer close elsewhere as closedElsewhere (#93)', async () => {
    const { cache, setScan } = setup();
    setScan(async () => new Map([[1, [{ ...CLAIM, status: 'done' }]]]));
    const marks = await cache.marks([issue(1)], createDefaultConfig());
    expect(marks.get(1)).toEqual({
      closedElsewhere: {
        ref: 'agent-1',
        worktree: '/tmp/agent-1',
        status: 'done',
        updated: '2026-01-02T00:00:00Z',
      },
    });
  });
});
