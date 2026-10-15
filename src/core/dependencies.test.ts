import { describe, expect, test } from 'bun:test';
import { createDefaultConfig } from './config.ts';
import {
  blocksOf,
  childrenOf,
  describeDependencies,
  indexIssues,
  openBlockers,
  parseLinkChanges,
  parseUnlinkChanges,
  validateLinks,
} from './dependencies.ts';
import type { Issue } from './types.ts';

const CONFIG = createDefaultConfig();

/** Regression tests for #55: issue dependencies (blockedBy / parent). */

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
    issue(2, { blockedBy: [1] }),
    issue(3, { blockedBy: [1, 2], parent: 1 }),
    issue(4, { parent: 1 }),
  ];

  test('blocksOf is the inverse of blockedBy', () => {
    expect(blocksOf(1, issues)).toEqual([2, 3]);
    expect(blocksOf(2, issues)).toEqual([3]);
    expect(blocksOf(3, issues)).toEqual([]);
  });

  test('childrenOf is the inverse of parent', () => {
    expect(childrenOf(1, issues)).toEqual([3, 4]);
    expect(childrenOf(2, issues)).toEqual([]);
  });

  test('a blocker is resolved when done, cancelled or missing', () => {
    const byId = indexIssues([
      issue(1, { status: 'done' }),
      issue(2, { status: 'cancelled' }),
      issue(3, { status: 'in_progress' }),
      issue(9, { blockedBy: [1, 2, 3, 4] }),
    ]);
    expect(openBlockers(byId.get(9) as Issue, byId, CONFIG)).toEqual([3]);
  });

  test('describeDependencies resolves titles and statuses', () => {
    const byId = indexIssues([
      ...issues,
      issue(5, { blockedBy: [3, 42], parent: 4 }),
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

describe('validateLinks', () => {
  const byId = indexIssues([
    issue(1),
    issue(2, { blockedBy: [1] }),
    issue(3, { blockedBy: [2] }),
    issue(4, { parent: 3 }),
    issue(5, { status: 'done', blockedBy: [3] }),
  ]);

  test('accepts new, valid links', () => {
    expect(validateLinks(3, { blockedBy: [1], parent: 1 }, byId)).toEqual([]);
  });

  test('rejects self-references', () => {
    expect(validateLinks(1, { blockedBy: [1] }, byId)).toEqual([
      "Issue #1 can't be blocked by itself",
    ]);
    expect(validateLinks(1, { parent: 1 }, byId)).toEqual([
      "Issue #1 can't be its own parent",
    ]);
  });

  test('rejects targets that do not exist', () => {
    expect(validateLinks(1, { blockedBy: [99], parent: 98 }, byId)).toEqual([
      'Issue #99 not found (blocked-by of #1)',
      'Issue #98 not found (parent of #1)',
    ]);
  });

  test('rejects blockedBy cycles, direct and transitive', () => {
    expect(validateLinks(1, { blockedBy: [2] }, byId)).toEqual([
      '#1 blocked by #2 would create a dependency cycle (#1 → #2 → #1)',
    ]);
    expect(validateLinks(1, { blockedBy: [3] }, byId)).toEqual([
      '#1 blocked by #3 would create a dependency cycle (#1 → #3 → #2 → #1)',
    ]);
    // Through a closed issue too: it's still a cycle in the graph.
    expect(validateLinks(1, { blockedBy: [5] }, byId)).toHaveLength(1);
  });

  test('rejects parent cycles', () => {
    expect(validateLinks(3, { parent: 4 }, byId)).toEqual([
      'Parent #4 would create a parent cycle (#3 → #4 → #3)',
    ]);
  });
});

describe('parseLinkChanges / parseUnlinkChanges', () => {
  test('accepts one ID or a list, numbers or "#N" strings', () => {
    expect(parseLinkChanges({ blockedBy: 3 })).toEqual({
      valid: true,
      values: { blockedBy: [3] },
      errors: [],
    });
    expect(parseLinkChanges({ blockedBy: ['#3', '4'], parent: '2' })).toEqual({
      valid: true,
      values: { blockedBy: [3, 4], parent: 2 },
      errors: [],
    });
  });

  test('rejects bad shapes and empty input', () => {
    expect(parseLinkChanges(null).valid).toBe(false);
    expect(parseLinkChanges({}).errors).toEqual([
      'Nothing to link: give blockedBy and/or parent',
    ]);
    expect(parseLinkChanges({ blockedBy: [] }).valid).toBe(false);
    expect(parseLinkChanges({ blockedBy: [1, 'x'] }).valid).toBe(false);
    expect(parseLinkChanges({ blockedBy: 0 }).valid).toBe(false);
    expect(parseLinkChanges({ parent: 1.5 }).valid).toBe(false);
  });

  test('unlink takes parent: true to clear the parent', () => {
    expect(parseUnlinkChanges({ parent: true })).toEqual({
      valid: true,
      values: { parent: true },
      errors: [],
    });
    expect(parseUnlinkChanges({ parent: 3 }).valid).toBe(false);
    expect(parseUnlinkChanges({ parent: false }).valid).toBe(false);
  });
});
