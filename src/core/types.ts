/**
 * A status name. Statuses are configured in `config.yaml` (`statuses`); the
 * built-in defaults are in `src/core/workflow.ts` (`DEFAULT_STATUSES`).
 */
export type Status = string;

/**
 * A priority name. Priorities are configured in `config.yaml`
 * (`priorities`, most urgent first); the built-in defaults are in
 * `src/core/workflow.ts` (`DEFAULT_PRIORITIES`).
 */
export type Priority = string;

/** One configured status (`config.statuses` entry, normalized). */
export interface StatusDefinition {
  name: Status;
  /** Display name (default: the name, humanized). */
  label?: string;
  /** Badge color, `#rgb` / `#rrggbb` (default: built-in or gray). */
  color?: string;
  /** Whether issues in this status are closed (live in `.issues/closed/`). */
  closed: boolean;
}

/** One configured priority (`config.priorities` entry, normalized). */
export interface PriorityDefinition {
  name: Priority;
  /** Display name (default: the name, humanized). */
  label?: string;
  /** Badge color, `#rgb` / `#rrggbb` (default: built-in or gray). */
  color?: string;
}

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
  /** Workflow order (display order of dropdowns and filters). */
  statuses: StatusDefinition[];
  labels: Record<string, string>;
  assignees: Assignee[];
  /** Most urgent first (the `--sort priority` order). */
  priorities: PriorityDefinition[];
  /** Status of new issues; must be an open status. */
  defaultStatus: Status;
  defaultPriority: Priority;
  /**
   * The status `claim` sets (an issue in it and assigned is "claimed"); open.
   * Unset: see `activeStatus()` in `src/core/workflow.ts` (`in_progress`).
   */
  activeStatus?: Status;
  /** The status `unclaim` moves an active issue back to; open. Unset: `todo`. */
  unclaimStatus?: Status;
  /** The status `close` sets; closed. Unset: `done`. */
  closeStatus?: Status;
  /** The status `close --cancelled` sets; closed. Unset: `cancelled`. */
  cancelStatus?: Status;
  git: GitConfig;
}

export type OutputFormat = 'human' | 'json' | 'yaml';
