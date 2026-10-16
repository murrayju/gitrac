import type { IssueFilters } from '../api.ts';

/** The list view's filter selections, as kept in `filterStore`. */
export interface ListFilterState {
  statusFilter: string;
  priorityFilter: string;
  assigneeFilter: string;
  labelFilter: string;
  /** The search text (after the debounce). */
  search: string;
  mineFilter: boolean;
}

/**
 * The `GET /api/issues` filters for the list view's selections. Empty
 * selections are left out. Search text is trimmed; blank text means no
 * search. `mine` selects issues assigned to the server's identity.
 */
export function listFilters(state: ListFilterState): IssueFilters {
  const filters: IssueFilters = {};
  if (state.statusFilter) filters.status = state.statusFilter;
  if (state.priorityFilter) filters.priority = state.priorityFilter;
  if (state.assigneeFilter) filters.assignee = state.assigneeFilter;
  if (state.labelFilter) filters.label = state.labelFilter;
  const search = state.search.trim();
  if (search) filters.search = search;
  if (state.mineFilter) filters.mine = true;
  return filters;
}

/**
 * The label filter's choices: the configured labels, sorted, plus the
 * current selection if the config no longer has it (so the select still
 * shows it).
 */
export function labelFilterOptions(
  configured: Record<string, string> | undefined,
  selected: string,
): string[] {
  const names = Object.keys(configured ?? {});
  if (selected && !names.includes(selected)) names.push(selected);
  return names.sort((a, b) => a.localeCompare(b));
}
