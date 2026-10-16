import { useEffect } from 'react';
import { useConfig, useServerIdentity } from '../hooks.ts';
import { effectiveAuthor, identityOptions } from '../lib/identity.ts';
import { useIdentityStore } from '../stores/identityStore.ts';

/**
 * "Acting as" selector: who new issues and comments are attributed to, and
 * who claims an issue. The
 * default is the server's git identity; any configured assignee can be
 * picked instead (remembered in localStorage).
 */
export function IdentityPicker() {
  const author = useIdentityStore((s) => s.author);
  const setAuthor = useIdentityStore((s) => s.setAuthor);
  const { identity, refetch: refetchIdentity } = useServerIdentity();
  // Shared config (one fetch + one SSE connection for the whole tab).
  const { config, refetch: refetchConfig } = useConfig();
  const assignees = config?.assignees ?? null;

  // Load on mount and whenever the tab regains focus (git config / assignees
  // may have changed outside the browser).
  useEffect(() => {
    function onFocus() {
      refetchIdentity();
      refetchConfig();
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetchIdentity, refetchConfig]);

  // Drop a stored choice that is no longer a configured assignee.
  useEffect(() => {
    if (!identity || !assignees || !author) return;
    if (!effectiveAuthor(author, identity.name, assignees)) setAuthor('');
  }, [identity, assignees, author, setAuthor]);

  const options = identityOptions(identity?.name ?? null, assignees ?? []);
  if (options.length < 2) {
    return identity ? (
      <div
        className="text-xs text-gray-500 truncate"
        title={identity.email || undefined}
      >
        Acting as {identity.name}
      </div>
    ) : null;
  }

  return (
    <label className="block text-xs text-gray-500">
      <span className="block mb-1">Acting as</span>
      <select
        value={options.some((o) => o.value === author) ? author : ''}
        onChange={(e) => setAuthor(e.target.value)}
        className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 px-1.5 py-1 text-xs"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
