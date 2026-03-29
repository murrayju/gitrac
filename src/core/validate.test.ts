import { describe, expect, test } from 'bun:test';
import { createDefaultConfig } from './config.ts';
import type { Config, Issue } from './types.ts';
import { validateIssue } from './validate.ts';

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
