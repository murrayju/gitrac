import { create } from 'zustand';

export type SortField =
  | 'id'
  | 'title'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'updated';
export type SortDir = 'asc' | 'desc';

interface FilterState {
  statusFilter: string;
  priorityFilter: string;
  assigneeFilter: string;
  labelFilter: string;
  /** The search box text, as typed (the list debounces it). */
  searchText: string;
  /** Only issues assigned to the server's identity. */
  mineFilter: boolean;
  /** Also issues that exist only in another worktree or on a branch. */
  elsewhereFilter: boolean;
  sortField: SortField;
  sortDir: SortDir;
  setStatusFilter: (value: string) => void;
  setPriorityFilter: (value: string) => void;
  setAssigneeFilter: (value: string) => void;
  setLabelFilter: (value: string) => void;
  setSearchText: (value: string) => void;
  setMineFilter: (value: boolean) => void;
  setElsewhereFilter: (value: boolean) => void;
  setSortField: (value: SortField) => void;
  setSortDir: (value: SortDir) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  statusFilter: '',
  priorityFilter: '',
  assigneeFilter: '',
  labelFilter: '',
  searchText: '',
  mineFilter: false,
  elsewhereFilter: false,
  sortField: 'updated',
  sortDir: 'desc',
  setStatusFilter: (value) => set({ statusFilter: value }),
  setPriorityFilter: (value) => set({ priorityFilter: value }),
  setAssigneeFilter: (value) => set({ assigneeFilter: value }),
  setLabelFilter: (value) => set({ labelFilter: value }),
  setSearchText: (value) => set({ searchText: value }),
  setMineFilter: (value) => set({ mineFilter: value }),
  setElsewhereFilter: (value) => set({ elsewhereFilter: value }),
  setSortField: (value) => set({ sortField: value }),
  setSortDir: (value) => set({ sortDir: value }),
}));
