import { describe, expect, test } from 'bun:test';
import { createDefaultConfig } from './config.ts';
import type { Issue } from './types.ts';
import {
  authorError,
  hasLineBreak,
  INVALID_AUTHOR,
  parseLabelList,
  validateIssue,
  validateIssueFields,
} from './validate.ts';
import { priorityDefinitions, statusDefinitions } from './workflow.ts';

function makeValidIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 1,
    title: 'Test Issue',
    status: 'backlog',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2024-01-15T10:00:00Z',
    createdBy: 'alice',
    updated: '2024-01-15T10:00:00Z',
    description: 'A test issue.',
    comments: [],
    ...overrides,
  };
}

describe('validateIssue', () => {
  const config = createDefaultConfig();

  test('valid issue passes validation', () => {
    const result = validateIssue(makeValidIssue(), config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test('status not in config.statuses produces error', () => {
    const issue = makeValidIssue({
      status: 'invalid_status' as Issue['status'],
    });
    const result = validateIssue(issue, config);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('status'))).toBe(true);
  });

  test('priority not in config.priorities produces error', () => {
    const issue = makeValidIssue({
      priority: 'invalid_priority' as Issue['priority'],
    });
    const result = validateIssue(issue, config);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('priority'))).toBe(true);
  });

  test('labels not in config.labels produce warnings (not errors)', () => {
    const issue = makeValidIssue({ labels: ['nonexistent-label'] });
    const result = validateIssue(issue, config);
    expect(result.valid).toBe(true); // warnings don't fail validation
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('nonexistent-label'))).toBe(
      true,
    );
    expect(result.errors).toHaveLength(0);
  });

  test('missing id produces error', () => {
    const issue = makeValidIssue({ id: 0 });
    const result = validateIssue(issue, config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('id'))).toBe(true);
  });

  test('missing title produces error', () => {
    const issue = makeValidIssue({ title: '' });
    const result = validateIssue(issue, config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('title'))).toBe(true);
  });

  test('invalid date format produces error', () => {
    const issue = makeValidIssue({ created: 'not-a-date' });
    const result = validateIssue(issue, config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('created'))).toBe(true);
  });

  test('invalid updated date format produces error', () => {
    const issue = makeValidIssue({ updated: 'also-not-a-date' });
    const result = validateIssue(issue, config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('updated'))).toBe(true);
  });

  test('valid issue with known labels has no warnings', () => {
    const issue = makeValidIssue({ labels: ['bug', 'feature'] });
    const result = validateIssue(issue, config);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test('multiple errors are collected', () => {
    const issue = makeValidIssue({
      id: 0,
      title: '',
      status: 'invalid' as Issue['status'],
    });
    const result = validateIssue(issue, config);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('validateIssueFields', () => {
  const config = createDefaultConfig();

  test('accepts and normalizes valid fields', () => {
    const result = validateIssueFields(
      {
        title: '  Hello  ',
        status: 'todo',
        priority: 'high',
        assignee: ' alice ',
        labels: [' bug ', 'brand-new', 'bug'],
        description: 'desc',
      },
      config,
      { requireTitle: true },
    );
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.values).toEqual({
      title: 'Hello',
      status: 'todo',
      priority: 'high',
      assignee: 'alice',
      labels: ['bug', 'brand-new'],
      description: 'desc',
    });
  });

  test('omits absent fields (partial update)', () => {
    const result = validateIssueFields({ priority: 'low' }, config);
    expect(result.valid).toBe(true);
    expect(result.values).toEqual({ priority: 'low' });
  });

  test('requireTitle rejects a missing title', () => {
    const result = validateIssueFields({}, config, { requireTitle: true });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['title is required']);
  });

  test.each([
    [{ title: '' }, 'title'],
    [{ title: '   ' }, 'title'],
    [{ title: 42 }, 'title'],
    [{ status: 'bogus' }, 'status'],
    [{ status: 3 }, 'status'],
    [{ status: null }, 'status'],
    [{ priority: 'critical' }, 'priority'],
    [{ priority: ['high'] }, 'priority'],
    [{ assignee: 5 }, 'assignee'],
    [{ labels: 'bug' }, 'labels'],
    [{ labels: [1] }, 'labels'],
    [{ labels: [''] }, 'labels'],
    [{ labels: { bug: true } }, 'labels'],
    [{ description: { text: 'x' } }, 'description'],
    [{ title: 'Two\nlines' }, 'title'],
    [{ title: 'Carriage\rreturn' }, 'title'],
    [{ assignee: 'alice\nbob' }, 'assignee'],
    [{ assignee: 'alice\rbob' }, 'assignee'],
    [{ labels: ['ok', 'bad\nlabel'] }, 'labels'],
    [{ labels: ['bad\r\nlabel'] }, 'labels'],
  ])('rejects %j', (input, field) => {
    const result = validateIssueFields(input, config);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(field);
  });

  test('rejects statuses/priorities not in the configured lists', () => {
    const narrow = {
      ...config,
      statuses: statusDefinitions(['todo', 'done']),
      priorities: priorityDefinitions(['high', 'low']),
    };
    const result = validateIssueFields(
      { status: 'backlog', priority: 'medium' },
      narrow,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain('todo, done');
  });

  test('collects all errors at once', () => {
    const result = validateIssueFields(
      { title: '', status: 'x', priority: 'y', labels: 'z' },
      config,
    );
    expect(result.errors).toHaveLength(4);
  });

  test.each([
    [null],
    [undefined],
    ['str'],
    [7],
    [['a']],
  ])('rejects non-object input %j', (input) => {
    const result = validateIssueFields(input, config);
    expect(result.valid).toBe(false);
  });
});

describe('validateIssueFields line breaks', () => {
  const config = createDefaultConfig();

  test('names the problem in the message', () => {
    const result = validateIssueFields(
      { title: 'a\nb', assignee: 'c\nd', labels: ['e\nf'] },
      config,
    );
    expect(result.errors).toEqual([
      'Invalid title: must not contain line breaks',
      'Invalid assignee: must not contain line breaks',
      'Invalid labels: a label must not contain line breaks',
    ]);
  });

  test('a leading or trailing line break is trimmed away, not rejected', () => {
    const result = validateIssueFields(
      { title: ' Title \n', assignee: '\nalice\r\n', labels: ['bug\n'] },
      config,
    );
    expect(result.valid).toBe(true);
    expect(result.values).toEqual({
      title: 'Title',
      assignee: 'alice',
      labels: ['bug'],
    });
  });
});

describe('authorError', () => {
  test.each([
    ['Ada'],
    ['Grace Hopper'],
    ['ada@example.com'],
    ['Jean-Luc - Picard'],
  ])('accepts %j', (name) => {
    expect(authorError(name)).toBeNull();
  });

  test.each([
    [undefined],
    [null],
    [42],
    [''],
    ['   '],
  ])('rejects %j as not a non-empty string', (name) => {
    expect(authorError(name)).toBe(INVALID_AUTHOR);
  });

  test.each([
    ['Ada\nLovelace', 'line breaks'],
    ['Ada\r', 'line breaks'],
    ['\nAda', 'line breaks'],
    ['Ada\r\nLovelace', 'line breaks'],
    ['Ada \u2014 2026-01-01T00:00:00Z', 'em dash'],
    ['Ada\u2014Lovelace', 'em dash'],
  ])('rejects %j (%s)', (name, problem) => {
    const error = authorError(name);
    expect(error).toStartWith('Invalid author');
    expect(error).toContain(problem);
  });
});

describe('hasLineBreak', () => {
  test('detects \\n and \\r only', () => {
    expect(hasLineBreak('a\nb')).toBe(true);
    expect(hasLineBreak('a\rb')).toBe(true);
    expect(hasLineBreak('a\tb')).toBe(false);
    expect(hasLineBreak('plain')).toBe(false);
  });
});

describe('parseLabelList', () => {
  test('splits, trims and drops empty entries', () => {
    expect(parseLabelList('bug, ui ,,feature,')).toEqual([
      'bug',
      'ui',
      'feature',
    ]);
  });

  test('empty string clears labels', () => {
    expect(parseLabelList('')).toEqual([]);
    expect(parseLabelList(' , ')).toEqual([]);
  });
});
