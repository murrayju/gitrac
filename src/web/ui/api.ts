import type { Config, Issue, Priority, Status } from '../../core/types.ts';

export interface GitStatus {
  branch: string;
  defaultBranch: string;
  isDefaultBranch: boolean;
  hasUnpushedCommits: boolean;
  hasRemote: boolean;
}

export interface IssueFilters {
  status?: string;
  assignee?: string;
  label?: string;
  priority?: string;
  sort?: string;
}

export interface CreateIssueInput {
  title: string;
  priority?: Priority;
  labels?: string[];
  assignee?: string;
  status?: Status;
  description?: string;
}

export interface UpdateIssueInput {
  title?: string;
  priority?: Priority;
  labels?: string[];
  assignee?: string;
  status?: Status;
  description?: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchIssues(filters?: IssueFilters): Promise<Issue[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.assignee) params.set('assignee', filters.assignee);
  if (filters?.label) params.set('label', filters.label);
  if (filters?.priority) params.set('priority', filters.priority);
  if (filters?.sort) params.set('sort', filters.sort);
  const qs = params.toString();
  return request<Issue[]>(`/api/issues${qs ? `?${qs}` : ''}`);
}

export async function fetchIssue(id: number): Promise<Issue> {
  return request<Issue>(`/api/issues/${id}`);
}

export async function createIssue(input: CreateIssueInput): Promise<Issue> {
  return request<Issue>('/api/issues', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateIssue(
  id: number,
  input: UpdateIssueInput,
): Promise<Issue> {
  return request<Issue>(`/api/issues/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function addComment(
  id: number,
  body: string,
  author?: string,
): Promise<Issue> {
  return request<Issue>(`/api/issues/${id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, author }),
  });
}

export async function closeIssue(id: number): Promise<Issue> {
  return request<Issue>(`/api/issues/${id}/close`, { method: 'PATCH' });
}

export async function reopenIssue(id: number): Promise<Issue> {
  return request<Issue>(`/api/issues/${id}/reopen`, { method: 'PATCH' });
}

export async function fetchConfig(): Promise<Config> {
  return request<Config>('/api/config');
}

export async function updateLabelColors(
  labelColors: Record<string, string>,
): Promise<Config> {
  return request<Config>('/api/config/labels', {
    method: 'PATCH',
    body: JSON.stringify({ labelColors }),
  });
}

export async function fetchGitStatus(): Promise<GitStatus> {
  return request<GitStatus>('/api/git/status');
}

export interface AssetUploadResult {
  filename: string;
  url: string;
}

export async function uploadAsset(file: File): Promise<AssetUploadResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/issues/assets', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload failed ${res.status}: ${body}`);
  }
  return res.json() as Promise<AssetUploadResult>;
}
