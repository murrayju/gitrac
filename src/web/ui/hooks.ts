import { useCallback, useEffect, useRef, useState } from 'react';
import type { Config, Issue } from '../../core/types.ts';
import {
  fetchConfig,
  fetchGitStatus,
  fetchIssue,
  fetchIssues,
} from './api.ts';
import type { GitStatus, IssueFilters } from './api.ts';

export function useSSE(onEvent: () => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource('/api/events');

      es.addEventListener('issues-changed', () => {
        onEventRef.current();
      });

      es.onerror = () => {
        es?.close();
        // Reconnect after 3 seconds
        reconnectTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);
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
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [issue, setIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    fetchIssue(id)
      .then((data) => {
        setIssue(data);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useSSE(refetch);

  return { issue, loading, error, refetch };
}

export function useConfig(): {
  config: Config | null;
  loading: boolean;
  error: string | null;
} {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig()
      .then((data) => {
        setConfig(data);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { config, loading, error };
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
