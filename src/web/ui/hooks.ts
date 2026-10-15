import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Config, Issue } from '../../core/types.ts';
import type { Draft, GitStatus, IssueFilters } from './api.ts';
import {
  fetchConfig,
  fetchDrafts,
  fetchGitStatus,
  fetchIssues,
  fetchIssueVersioned,
} from './api.ts';
import { issueEvents } from './lib/event-stream.ts';
import { createSharedQuery } from './lib/shared-query.ts';

/**
 * Call `onEvent` whenever the server reports changes (and on every
 * (re)connect). All callers share one tab-wide `EventSource`.
 */
export function useSSE(onEvent: () => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => issueEvents().subscribe(() => onEventRef.current()), []);
}

export function useIssues(filters?: IssueFilters): {
  issues: Issue[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filtersJson = JSON.stringify(filters ?? {});

  const refetch = useCallback(() => {
    const parsed = JSON.parse(filtersJson) as IssueFilters;
    setLoading(true);
    fetchIssues(parsed)
      .then((data) => {
        setIssues(data);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filtersJson]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useSSE(refetch);

  return { issues, loading, error, refetch };
}

export function useIssue(id: number): {
  issue: Issue | null;
  /** ETag of `issue` as served; send it as `If-Match` to avoid clobbering. */
  version: string | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /** Adopt an issue returned by a mutation, discarding older in-flight fetches. */
  applyIssue: (issue: Issue, version: string | null) => void;
} {
  const [state, setState] = useState<{
    issue: Issue | null;
    version: string | null;
  }>({ issue: null, version: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Responses can arrive out of order (SSE bursts, our own saves); only
  // apply a fetch if nothing newer has been applied since it started.
  const seqRef = useRef(0);
  const appliedRef = useRef(0);

  const refetch = useCallback(() => {
    const seq = ++seqRef.current;
    setLoading(true);
    fetchIssueVersioned(id)
      .then(({ data, version }) => {
        if (seq < appliedRef.current) return;
        appliedRef.current = seq;
        setState({ issue: data, version });
        setError(null);
      })
      .catch((e: Error) => {
        if (seq >= appliedRef.current) setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const applyIssue = useCallback((issue: Issue, version: string | null) => {
    appliedRef.current = ++seqRef.current;
    setState({ issue, version });
    setError(null);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useSSE(refetch);

  return { ...state, loading, error, refetch, applyIssue };
}

// Config is shared by every component (each list row reads label colors), so
// it is fetched once per change, not once per consumer. Re-fetched when
// issues change, since label colors may have been assigned.
const configQuery = createSharedQuery(fetchConfig, (refetch) =>
  issueEvents().subscribe(refetch),
);

export function useConfig(): {
  config: Config | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /** Adopt a config returned by a mutation (e.g. `updateAssignees`). */
  applyConfig: (config: Config) => void;
} {
  const { data, loading, error } = useSyncExternalStore(
    configQuery.subscribe,
    configQuery.getSnapshot,
  );
  return {
    config: data,
    loading,
    error,
    refetch: refetchConfig,
    applyConfig: configQuery.set,
  };
}

function refetchConfig(): void {
  void configQuery.refetch();
}

export function useGitStatus(): {
  gitStatus: GitStatus | null;
  loading: boolean;
  error: string | null;
} {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function fetch() {
      fetchGitStatus()
        .then((data) => {
          setGitStatus(data);
          setError(null);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }

    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, []);

  return { gitStatus, loading, error };
}

export function useDrafts(): {
  drafts: Draft[];
  loading: boolean;
  refresh: () => void;
} {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    fetchDrafts()
      .then((data) => setDrafts(data))
      .catch(() => {
        // ignore
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { drafts, loading, refresh };
}
