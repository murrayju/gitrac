import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaimUser } from '../core/claim.ts';
import type { Issue } from '../core/types.ts';
import { initIssuesDir } from '../fs/issue-store.ts';
import type { CommitRequest } from './commit.ts';
import {
  CLI_POLICY,
  type ServiceContext,
  type WrittenChange,
} from './context.ts';

/** Shared setup for the service-layer unit tests (no git repo needed). */
export interface ServiceFixture {
  dir: string;
  /** Commits requested through the recording strategy, in order. */
  commits: CommitRequest[];
  /** `onWritten` calls, in order. */
  written: WrittenChange[];
  /** Events in order: `written:<op>` / `commit:<op>`. */
  events: string[];
  /** A context with a recording commit strategy; override anything. */
  context(overrides?: Partial<ServiceContext>): ServiceContext;
  cleanup(): Promise<void>;
}

export const ADA: ClaimUser = { name: 'Ada', email: 'ada@example.com' };

export async function serviceFixture(): Promise<ServiceFixture> {
  const dir = await mkdtemp(join(tmpdir(), 'gitrac-service-'));
  await initIssuesDir(dir);
  const commits: CommitRequest[] = [];
  const written: WrittenChange[] = [];
  const events: string[] = [];
  return {
    dir,
    commits,
    written,
    events,
    context: (overrides = {}) => ({
      dir,
      identity: async () => ADA,
      push: false,
      policy: CLI_POLICY,
      commit: async (request) => {
        commits.push(request);
        events.push(`commit:${request.operation}`);
        return 'abc123';
      },
      onWritten: (change) => {
        written.push(change);
        events.push(`written:${change.operation}`);
      },
      ...overrides,
    }),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

export function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 1,
    title: 'Test Issue',
    status: 'backlog',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2025-01-01T00:00:00Z',
    createdBy: 'tester',
    updated: '2025-01-01T00:00:00Z',
    description: 'A test issue description.',
    comments: [],
    ...overrides,
  };
}
