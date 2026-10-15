import type { IssueDependencies } from '../../core/dependencies.ts';
import type { ClaimedElsewhere } from '../../core/elsewhere.ts';
import type {
  Assignee,
  Config,
  Issue,
  Priority,
  Status,
} from '../../core/types.ts';

/**
 * An issue as served by `GET /api/issues` / `GET /api/issues/:id` (and
 * mutation responses): plus `claimedElsewhere` when its newest version is a
 * claim in another worktree or on another branch.
 */
export type ApiIssue = Issue & { claimedElsewhere?: ClaimedElsewhere };

export interface Draft {
  filename: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee: string;
  labels: string[];
  savedAt: string;
}

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
  /** Words that must all appear in the title or description. */
  search?: string;
  /** Only issues assigned to the server's identity. */
  mine?: boolean;
  sort?: string;
}

export interface CreateIssueInput {
  title: string;
  priority?: Priority;
  labels?: string[];
  assignee?: string;
  status?: Status;
  description?: string;
  /** Recorded as `createdBy`; omitted = the server's git identity. */
  author?: string;
}

export interface UpdateIssueInput {
  title?: string;
  priority?: Priority;
  labels?: string[];
  assignee?: string;
  status?: Status;
  description?: string;
}

/** Non-2xx API response. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`API error ${status}: ${body}`);
    this.name = 'ApiError';
  }
}

/**
 * 409 from a mutation sent with `If-Match`: the issue changed since the
 * version we based the edit on. Carries the current issue and its version.
 */
export class ConflictError extends ApiError {
  constructor(
    body: string,
    readonly current: Issue,
    readonly version: string | null,
  ) {
    super(409, body);
    this.name = 'ConflictError';
  }
}

/** A response body plus the resource version (ETag) it was served with. */
export interface Versioned<T> {
  data: T;
  version: string | null;
}

/** Headers for an optimistic-concurrency write based on `version`. */
function ifMatch(version: string | null | undefined): Record<string, string> {
  return version ? { 'If-Match': version } : {};
}

async function requestVersioned<T>(
  path: string,
  options?: RequestInit,
): Promise<Versioned<T>> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 409) {
      let current: Issue | undefined;
      try {
        current = (JSON.parse(body) as { current?: Issue }).current;
      } catch {
        // not a conflict payload
      }
      if (current) {
        throw new ConflictError(body, current, res.headers.get('ETag'));
      }
    }
    throw new ApiError(res.status, body);
  }
  return {
    data: (await res.json()) as T,
    version: res.headers.get('ETag'),
  };
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  return (await requestVersioned<T>(path, options)).data;
}

export async function fetchIssues(filters?: IssueFilters): Promise<ApiIssue[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.assignee) params.set('assignee', filters.assignee);
  if (filters?.label) params.set('label', filters.label);
  if (filters?.priority) params.set('priority', filters.priority);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.mine) params.set('mine', '1');
  if (filters?.sort) params.set('sort', filters.sort);
  const qs = params.toString();
  return request<ApiIssue[]>(`/api/issues${qs ? `?${qs}` : ''}`);
}

export async function fetchIssue(id: number): Promise<ApiIssue> {
  return request<ApiIssue>(`/api/issues/${id}`);
}

/** Fetch an issue along with its current version (ETag). */
export async function fetchIssueVersioned(
  id: number,
): Promise<Versioned<ApiIssue>> {
  return requestVersioned<ApiIssue>(`/api/issues/${id}`);
}

/** An issue's parent, sub-issues, blockers and the issues it blocks. */
export async function fetchIssueDependencies(
  id: number,
): Promise<IssueDependencies> {
  return request<IssueDependencies>(`/api/issues/${id}/dependencies`);
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

/**
 * Update an issue only if it is still at `baseVersion`; throws
 * `ConflictError` if it changed. Returns the issue and its new version.
 */
export async function updateIssueVersioned(
  id: number,
  input: UpdateIssueInput,
  baseVersion: string | null,
): Promise<Versioned<Issue>> {
  return requestVersioned<Issue>(`/api/issues/${id}`, {
    method: 'PATCH',
    headers: ifMatch(baseVersion),
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

export async function updateComment(
  issueId: number,
  commentIndex: number,
  body: string,
  baseVersion?: string | null,
): Promise<Issue> {
  return request<Issue>(`/api/issues/${issueId}/comments/${commentIndex}`, {
    method: 'PUT',
    headers: ifMatch(baseVersion),
    body: JSON.stringify({ body }),
  });
}

export async function deleteComment(
  issueId: number,
  commentIndex: number,
  baseVersion?: string | null,
): Promise<Issue> {
  return request<Issue>(`/api/issues/${issueId}/comments/${commentIndex}`, {
    method: 'DELETE',
    headers: ifMatch(baseVersion),
  });
}

export async function closeIssue(id: number): Promise<Issue> {
  return request<Issue>(`/api/issues/${id}/close`, { method: 'PATCH' });
}

export async function reopenIssue(id: number): Promise<Issue> {
  return request<Issue>(`/api/issues/${id}/reopen`, { method: 'PATCH' });
}

/** What `DELETE /api/issues/:id` removed. */
export interface IssueDeletion {
  deleted: true;
  /** The issue as it was before deletion. */
  issue: Issue;
  /** Repo-relative paths removed: the issue file, then orphaned assets. */
  paths: string[];
  assets: string[];
  /** Other issues whose `blockedBy` / `parent` links to it were removed. */
  unlinked: {
    id: number;
    title: string;
    blockedBy: boolean;
    parent: boolean;
    paths: string[];
  }[];
}

/**
 * Delete an issue, only if it is still at `baseVersion` (throws
 * `ConflictError` if it changed, so you never delete something you haven't
 * seen).
 */
export async function deleteIssue(
  id: number,
  baseVersion?: string | null,
): Promise<IssueDeletion> {
  return request<IssueDeletion>(`/api/issues/${id}`, {
    method: 'DELETE',
    headers: ifMatch(baseVersion),
  });
}

export async function fetchConfig(): Promise<Config> {
  return request<Config>('/api/config');
}

/** The server's default identity (git `user.name` / `user.email`). */
export interface Identity {
  name: string;
  email: string;
}

export async function fetchIdentity(): Promise<Identity> {
  return request<Identity>('/api/identity');
}

export async function updateLabels(
  labels: Record<string, string>,
): Promise<Config> {
  return request<Config>('/api/config/labels', {
    method: 'PATCH',
    body: JSON.stringify({ labels }),
  });
}

export async function updateAssignees(assignees: Assignee[]): Promise<Config> {
  return request<Config>('/api/config/assignees', {
    method: 'PATCH',
    body: JSON.stringify({ assignees }),
  });
}

export async function fetchGitStatus(): Promise<GitStatus> {
  return request<GitStatus>('/api/git/status');
}

export interface AssetUploadResult {
  filename: string;
  url: string;
}

export async function fetchDrafts(): Promise<Draft[]> {
  return request<Draft[]>('/api/drafts');
}

export async function saveDraft(
  filename: string,
  data: Omit<Draft, 'filename' | 'savedAt'>,
): Promise<Draft> {
  return request<Draft>(`/api/drafts/${filename}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteDraft(filename: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/drafts/${filename}`, {
    method: 'DELETE',
  });
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
