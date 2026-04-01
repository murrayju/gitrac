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
  sortField: SortField;
  sortDir: SortDir;
  setStatusFilter: (value: string) => void;
  setPriorityFilter: (value: string) => void;
  setAssigneeFilter: (value: string) => void;
  setSortField: (value: SortField) => void;
  setSortDir: (value: SortDir) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  statusFilter: '',
  priorityFilter: '',
  assigneeFilter: '',
  sortField: 'updated',
  sortDir: 'desc',
  setStatusFilter: (value) => set({ statusFilter: value }),
  setPriorityFilter: (value) => set({ priorityFilter: value }),
  setAssigneeFilter: (value) => set({ assigneeFilter: value }),
  setSortField: (value) => set({ sortField: value }),
  setSortDir: (value) => set({ sortDir: value }),
}));
