import { describe, expect, test } from 'bun:test';
import { issueListQuery } from '../api.ts';
import {
  type ListFilterState,
  labelFilterOptions,
  listFilters,
} from './list-filters.ts';

const none: ListFilterState = {
  statusFilter: '',
  priorityFilter: '',
  assigneeFilter: '',
  labelFilter: '',
  search: '',
  mineFilter: false,
};

describe('listFilters', () => {
  test('no selections: no filters (open issues)', () => {
    expect(listFilters(none)).toEqual({});
    expect(issueListQuery(listFilters(none))).toBe('');
  });

  test('maps every selection to its query parameter', () => {
    const filters = listFilters({
      statusFilter: 'all',
      priorityFilter: 'high',
      assigneeFilter: 'ada@example.com',
      labelFilter: 'bug',
      search: '  login  timeout ',
      mineFilter: true,
    });
    expect(filters).toEqual({
      status: 'all',
      priority: 'high',
      assignee: 'ada@example.com',
      label: 'bug',
      search: 'login  timeout',
      mine: true,
    });
    const params = new URLSearchParams(issueListQuery(filters));
    expect(params.get('label')).toBe('bug');
    expect(params.get('search')).toBe('login  timeout');
    expect(params.get('mine')).toBe('1');
    expect(params.get('status')).toBe('all');
  });

  // #113: "Mine" follows the "Acting as" identity.
  test('mine sends the acting author; omitted for the server identity', () => {
    const acting = listFilters({
      ...none,
      mineFilter: true,
      actingAuthor: 'Bob Builder',
    });
    expect(acting).toEqual({ mine: true, author: 'Bob Builder' });
    const params = new URLSearchParams(issueListQuery(acting));
    expect(params.get('mine')).toBe('1');
    expect(params.get('author')).toBe('Bob Builder');

    const server = listFilters({ ...none, mineFilter: true });
    expect(server).toEqual({ mine: true });
    expect(issueListQuery(server)).toBe('?mine=1');
  });

  test('without mine, the acting author is not sent', () => {
    expect(listFilters({ ...none, actingAuthor: 'Bob Builder' })).toEqual({});
    expect(issueListQuery({ author: 'Bob Builder' })).toBe('');
  });

  // #110: the "Other worktrees/branches" toggle.
  test('elsewhere sends elsewhere=1; off by default', () => {
    expect(listFilters({ ...none, elsewhereFilter: false })).toEqual({});
    const filters = listFilters({
      ...none,
      elsewhereFilter: true,
      labelFilter: 'bug',
    });
    expect(filters).toEqual({ elsewhere: true, label: 'bug' });
    expect(issueListQuery(filters)).toBe('?label=bug&elsewhere=1');
  });

  test('blank search text is no search', () => {
    expect(listFilters({ ...none, search: '   ' })).toEqual({});
  });

  test('query values are URL-encoded', () => {
    expect(issueListQuery({ search: 'a&b c', label: 'ui/ux' })).toBe(
      '?label=ui%2Fux&search=a%26b+c',
    );
  });
});

describe('labelFilterOptions', () => {
  test('configured labels, sorted', () => {
    expect(
      labelFilterOptions({ ui: '#111', bug: '#222', feature: '#333' }, ''),
    ).toEqual(['bug', 'feature', 'ui']);
  });

  test('keeps a selection the config no longer has', () => {
    expect(labelFilterOptions({ bug: '#222' }, 'gone')).toEqual([
      'bug',
      'gone',
    ]);
    expect(labelFilterOptions(undefined, 'gone')).toEqual(['gone']);
    expect(labelFilterOptions(undefined, '')).toEqual([]);
  });
});
