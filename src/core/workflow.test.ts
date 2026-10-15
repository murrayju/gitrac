import { describe, expect, test } from 'bun:test';
import { createDefaultConfig, parseConfig } from './config.ts';
import type { Config } from './types.ts';
import {
  activeStatus,
  cancelStatus,
  closedStatuses,
  closeStatus,
  humanize,
  isClosedStatus,
  openStatuses,
  priorityLabel,
  statusDefinitions,
  statusLabel,
  statusSortOrder,
  unclaimStatus,
} from './workflow.ts';

/** Regression tests for #57: configurable statuses and priorities. */

function withStatuses(names: string[], extra: Partial<Config> = {}): Config {
  return {
    ...createDefaultConfig(),
    statuses: statusDefinitions(names),
    defaultStatus: names[0] as string,
    ...extra,
  };
}

describe('built-in workflow', () => {
  const config = createDefaultConfig();

  test('done/cancelled are closed, the rest open', () => {
    expect(openStatuses(config)).toEqual(['backlog', 'todo', 'in_progress']);
    expect(closedStatuses(config)).toEqual(['done', 'cancelled']);
    expect(isClosedStatus(config, 'done')).toBe(true);
    expect(isClosedStatus(config, 'todo')).toBe(false);
  });

  test('claim/unclaim/close statuses default to the built-in names', () => {
    expect(activeStatus(config)).toBe('in_progress');
    expect(unclaimStatus(config)).toBe('todo');
    expect(closeStatus(config)).toBe('done');
    expect(cancelStatus(config)).toBe('cancelled');
  });

  test('status sort order is unchanged: in_progress, todo, backlog, done, cancelled', () => {
    expect(statusSortOrder(config)).toEqual([
      'in_progress',
      'todo',
      'backlog',
      'done',
      'cancelled',
    ]);
  });

  test('labels default to the humanized name', () => {
    expect(statusLabel(config, 'in_progress')).toBe('In Progress');
    expect(statusLabel(config, 'todo')).toBe('Todo');
    expect(priorityLabel(config, 'urgent')).toBe('Urgent');
    expect(humanize('needs-review')).toBe('Needs Review');
  });
});

describe('configured workflow', () => {
  const config = parseConfig(`version: 1
statuses:
  - new
  - name: doing
    label: Working on it
  - name: shipped
    closed: true
  - name: dropped
    closed: true
labels: {}
priorities:
  - name: p0
    label: Critical
  - p1
defaultStatus: new
defaultPriority: p1
activeStatus: doing
unclaimStatus: new
closeStatus: shipped
cancelStatus: dropped
`);

  test('explicit keys win', () => {
    expect(activeStatus(config)).toBe('doing');
    expect(unclaimStatus(config)).toBe('new');
    expect(closeStatus(config)).toBe('shipped');
    expect(cancelStatus(config)).toBe('dropped');
  });

  test('closed comes from the definitions', () => {
    expect(closedStatuses(config)).toEqual(['shipped', 'dropped']);
    expect(statusSortOrder(config)).toEqual([
      'doing',
      'new',
      'shipped',
      'dropped',
    ]);
  });

  test('labels come from the definitions', () => {
    expect(statusLabel(config, 'doing')).toBe('Working on it');
    expect(statusLabel(config, 'new')).toBe('New');
    expect(priorityLabel(config, 'p0')).toBe('Critical');
  });

  test('a status that is not configured is judged by the legacy rule', () => {
    expect(isClosedStatus(config, 'done')).toBe(true);
    expect(isClosedStatus(config, 'whatever')).toBe(false);
  });
});

describe('fallbacks when the workflow keys are unset', () => {
  test('active: in_progress if configured, else the last open status', () => {
    expect(activeStatus(withStatuses(['todo', 'in_progress', 'done']))).toBe(
      'in_progress',
    );
    expect(activeStatus(withStatuses(['new', 'doing', 'done']))).toBe('doing');
  });

  test('unclaim: todo if configured (and not active), else defaultStatus', () => {
    expect(
      unclaimStatus(withStatuses(['backlog', 'todo', 'in_progress', 'done'])),
    ).toBe('todo');
    // todo is the (fallback) active status here, so not the unclaim one.
    expect(unclaimStatus(withStatuses(['backlog', 'todo', 'done']))).toBe(
      'backlog',
    );
    expect(unclaimStatus(withStatuses(['new', 'doing', 'done']))).toBe('new');
  });

  test('close: done if configured, else the first closed status', () => {
    expect(closeStatus(withStatuses(['open', 'fixed', 'done']))).toBe('done');
    const custom = withStatuses(['open'], {
      statuses: [
        { name: 'open', closed: false },
        { name: 'fixed', closed: true },
        { name: 'wontfix', closed: true },
      ],
    });
    expect(closeStatus(custom)).toBe('fixed');
    expect(cancelStatus(custom)).toBeUndefined();
  });

  test('cancel: cancelled only if it is a configured closed status', () => {
    expect(cancelStatus(withStatuses(['open', 'done', 'cancelled']))).toBe(
      'cancelled',
    );
    expect(cancelStatus(withStatuses(['open', 'done']))).toBeUndefined();
  });
});
