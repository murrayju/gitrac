export type Status = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
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
  created: string;
  createdBy: string;
  updated: string;
}

export interface GitConfig {
  autoCommit: boolean;
  autoPush: boolean;
  commitPrefix: string;
  defaultBranch: string;
}

export interface Config {
  version: number;
  nextId: number;
  statuses: Status[];
  labels: string[];
  priorities: Priority[];
  defaultStatus: Status;
  defaultPriority: Priority;
  git: GitConfig;
}

export type OutputFormat = 'human' | 'json' | 'yaml';
