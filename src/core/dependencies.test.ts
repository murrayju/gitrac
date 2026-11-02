import { describe, expect, test } from 'bun:test';
import { createDefaultConfig } from './config.ts';
import {
  describeDependencies,
  indexIssues,
  openBlockers,
} from './dependencies.ts';
import { issueLinks } from './links.fixture.ts';
import { LinkGraph } from './links.ts';
import type { Issue } from './types.ts';

const CONFIG = createDefaultConfig();

/** Regression tests for #55 / #127: issue relations from `links`. */

function issue(id: number, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    title: `Issue ${id}`,
    status: 'todo',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2025-01-01T00:00:00Z',
    createdBy: 'tester',
    updated: '2025-01-01T00:00:00Z',
    description: '',
    comments: [],
    ...overrides,
  };
}

describe('derived relations', () => {
  const issues = [
    issue(1),
    issue(2, { links: issueLinks({ blockedBy: 1 }) }),
    issue(3, { links: issueLinks({ blockedBy: [1, 2], parent: 1 }) }),
    issue(4, { links: issueLinks({ parent: 1 }) }),
  ];

  test('a blocker is resolved when done, cancelled or missing', () => {
    const byId = indexIssues([
      issue(1, { status: 'done' }),
      issue(2, { status: 'cancelled' }),
      issue(3, { status: 'in_progress' }),
      issue(9, { links: issueLinks({ blockedBy: [1, 2, 3, 4] }) }),
    ]);
    const graph = new LinkGraph(byId.values());
    expect(openBlockers(9, graph, byId, CONFIG)).toEqual([3]);
  });

  test('describeDependencies resolves titles and statuses', () => {
    const byId = indexIssues([
      ...issues,
      issue(5, { links: issueLinks({ blockedBy: [3, 42], parent: 4 }) }),
    ]);
    const deps = describeDependencies(byId.get(3) as Issue, byId, CONFIG);
    expect(deps).toEqual({
      parent: { id: 1, title: 'Issue 1', status: 'todo', resolved: false },
      children: [],
      blockedBy: [
        { id: 1, title: 'Issue 1', status: 'todo', resolved: false },
        { id: 2, title: 'Issue 2', status: 'todo', resolved: false },
      ],
      blocks: [{ id: 5, title: 'Issue 5', status: 'todo', resolved: false }],
      duplicateOf: null,
      duplicates: [],
      related: [],
      blocked: true,
    });
    const five = describeDependencies(byId.get(5) as Issue, byId, CONFIG);
    expect(five.blockedBy[1]).toEqual({
      id: 42,
      title: '',
      status: null,
      resolved: true,
    });
  });
});

describe('links to issues only elsewhere (#120)', () => {
  const here = indexIssues([
    issue(1, { links: issueLinks({ blockedBy: [5, 6, 42], parent: 7 }) }),
    issue(2),
  ]);
  const wt = { ref: 'agent-1', worktree: '/w/wt-1' };
  const elsewhere = [
    { issue: issue(5, { title: 'Open there' }), foundElsewhere: wt },
    {
      issue: issue(6, { title: 'Done there', status: 'done' }),
      foundElsewhere: { ref: 'origin/x' },
    },
    { issue: issue(7, { title: 'Epic there' }), foundElsewhere: wt },
    {
      issue: issue(8, {
        title: 'Sub there',
        links: issueLinks({ parent: 1, blockedBy: 1 }),
      }),
      foundElsewhere: wt,
    },
  ];

  test('describeDependencies shows them with title, status and location', () => {
    const deps = describeDependencies(
      here.get(1) as Issue,
      here,
      CONFIG,
      elsewhere,
    );
    expect(deps).toEqual({
      parent: {
        id: 7,
        title: 'Epic there',
        status: 'todo',
        resolved: false,
        foundElsewhere: wt,
      },
      children: [
        {
          id: 8,
          title: 'Sub there',
          status: 'todo',
          resolved: false,
          foundElsewhere: wt,
        },
      ],
      blockedBy: [
        {
          id: 5,
          title: 'Open there',
          status: 'todo',
          resolved: false,
          foundElsewhere: wt,
        },
        // Closed there, but its work is not here yet: still blocks.
        {
          id: 6,
          title: 'Done there',
          status: 'done',
          resolved: false,
          foundElsewhere: { ref: 'origin/x' },
        },
        // Found nowhere (deleted): resolved.
        { id: 42, title: '', status: null, resolved: true },
      ],
      blocks: [
        {
          id: 8,
          title: 'Sub there',
          status: 'todo',
          resolved: false,
          foundElsewhere: wt,
        },
      ],
      duplicateOf: null,
      duplicates: [],
      related: [],
      blocked: true,
    });
  });

  test('a local issue wins over a version elsewhere', () => {
    const deps = describeDependencies(here.get(1) as Issue, here, CONFIG, [
      {
        issue: issue(2, {
          title: 'Stale copy',
          links: issueLinks({ blockedBy: 1 }),
        }),
        foundElsewhere: wt,
      },
    ]);
    expect(deps.blocks).toEqual([]);
  });

  test('openBlockers counts blockers only elsewhere, in any status', () => {
    const graph = new LinkGraph(here.values());
    expect(openBlockers(1, graph, here, CONFIG)).toEqual([]);
    expect(openBlockers(1, graph, here, CONFIG, new Set([5, 6]))).toEqual([
      5, 6,
    ]);
  });
});

describe('links stored on either side (#127)', () => {
  const byId = indexIssues([
    // #1 blocks #2 (stored on #1), #3 is the parent of #2 (stored on #3).
    issue(1, { links: issueLinks({ blocks: 2, related: 4 }) }),
    issue(2),
    issue(3, { links: issueLinks({ child: 2 }) }),
    issue(4, { links: issueLinks({ duplicatedBy: 2 }) }),
  ]);

  test('describeDependencies includes the links other issues store', () => {
    const two = describeDependencies(byId.get(2) as Issue, byId, CONFIG);
    expect(two.blockedBy.map((r) => r.id)).toEqual([1]);
    expect(two.parent?.id).toBe(3);
    expect(two.duplicateOf?.id).toBe(4);
    expect(two.blocked).toBe(true);
    const one = describeDependencies(byId.get(1) as Issue, byId, CONFIG);
    expect(one.blocks.map((r) => r.id)).toEqual([2]);
    expect(one.related.map((r) => r.id)).toEqual([4]);
    const four = describeDependencies(byId.get(4) as Issue, byId, CONFIG);
    expect(four.related.map((r) => r.id)).toEqual([1]);
    expect(four.duplicates.map((r) => r.id)).toEqual([2]);
  });
});
