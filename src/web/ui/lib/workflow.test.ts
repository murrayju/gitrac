import { describe, expect, test } from 'bun:test';
import { createDefaultConfig } from '../../../core/config.ts';
import {
  expandHex,
  priorityDotStyle,
  statusBadgeStyle,
  type WorkflowSource,
  workflowView,
} from './workflow.ts';

/** Regression tests for #57: UI dropdowns/badges come from the config. */

const custom: WorkflowSource = {
  statuses: [
    { name: 'new', closed: false },
    { name: 'doing', label: 'Working', color: '#abc', closed: false },
    { name: 'shipped', closed: true },
  ],
  priorities: [
    { name: 'p0', label: 'Critical', color: '#e05d5d' },
    { name: 'p1' },
  ],
};

describe('workflowView', () => {
  test('lists the configured statuses and priorities with labels', () => {
    const view = workflowView(custom);
    expect(view.statuses).toEqual(['new', 'doing', 'shipped']);
    expect(view.priorities).toEqual(['p0', 'p1']);
    expect(view.statusLabels).toEqual({
      new: 'New',
      doing: 'Working',
      shipped: 'Shipped',
    });
    expect(view.priorityLabels).toEqual({ p0: 'Critical', p1: 'P1' });
  });

  test('falls back to the built-in statuses until the config has loaded', () => {
    const view = workflowView(null);
    expect(view.statuses).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'done',
      'cancelled',
    ]);
    expect(view.statusLabels.in_progress).toBe('In Progress');
    expect(view.priorities).toEqual([
      'urgent',
      'high',
      'medium',
      'low',
      'none',
    ]);
  });
});

describe('badge styles', () => {
  test('a configured color tints the badge', () => {
    expect(statusBadgeStyle(custom, 'doing')).toEqual({
      className: '',
      style: { backgroundColor: '#aabbcc33', color: '#aabbcc' },
    });
    expect(priorityDotStyle(custom, 'p0')).toEqual({
      className: '',
      style: { backgroundColor: '#e05d5d' },
    });
  });

  test('built-in names keep their colors; others are gray', () => {
    const config = createDefaultConfig();
    expect(statusBadgeStyle(config, 'done').className).toContain('green');
    expect(statusBadgeStyle(custom, 'new').className).toContain('gray');
    expect(priorityDotStyle(config, 'urgent').className).toBe('bg-red-500');
    expect(priorityDotStyle(custom, 'p1').className).toBe('bg-gray-500');
  });

  test('expandHex', () => {
    expect(expandHex('#abc')).toBe('#aabbcc');
    expect(expandHex('#a1b2c3')).toBe('#a1b2c3');
  });
});
