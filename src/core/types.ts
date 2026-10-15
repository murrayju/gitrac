export type Status = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';

export const closedStatuses: Status[] = ['done', 'cancelled'];

export function isClosedStatus(status: Status): boolean {
  return closedStatuses.includes(status);
}
export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

export interface Comment {
  author: string;
  timestamp: string; // ISO 8601
  body: string; // raw markdown (unescaped)
}

export interface Issue {
  id: number;
  title: string;
  status: Status;
  priority: Priority;
  assignee: string; // empty string if unassigned
  labels: string[]; // empty array if none
  /**
   * The parent issue's ID (sub-issue of). Absent = no parent; only present
   * in the file when set.
   */
  parent?: number;
  /**
   * IDs of the issues this one is blocked by (ascending, no duplicates). The
   * inverse ("blocks") is derived, never stored. Absent or empty = not
   * blocked; only present in the file when non-empty.
   */
  blockedBy?: number[];
  created: string; // ISO 8601
  createdBy: string;
  updated: string; // ISO 8601
  description: string; // raw markdown
  comments: Comment[];
}

export interface IssueFrontmatter {
  id: number;
  title: string;
  status: Status;
  priority: Priority;
  assignee: string; // empty string if unassigned
  labels: string[]; // empty array if none
  parent?: number;
  blockedBy?: number[];
  created: string;
  createdBy: string;
  updated: string;
}

export interface Assignee {
  name: string;
  email: string;
}

export interface GitConfig {
  autoCommit: boolean;
  autoPush: boolean;
  commitPrefix: string;
  defaultBranch: string;
}

export interface Config {
  version: number;
  /**
   * Legacy ID counter. Older gitrac versions bumped it on every create; it's
   * now only read (as a lower bound for new IDs, see `allocateIssueId` in
   * `src/git/ids.ts`) and never written or added to new configs.
   */
  nextId?: number;
  statuses: Status[];
  labels: Record<string, string>;
  assignees: Assignee[];
  priorities: Priority[];
  defaultStatus: Status;
  defaultPriority: Priority;
  git: GitConfig;
}

export type OutputFormat = 'human' | 'json' | 'yaml';
