import { useEffect, useState } from 'react';
import type { Assignee } from '../../../core/types.ts';
import { fetchConfig, fetchIdentity, type Identity } from '../api.ts';
import { effectiveAuthor, identityOptions } from '../lib/identity.ts';
import { useIdentityStore } from '../stores/identityStore.ts';

/**
 * "Acting as" selector: who new issues and comments are attributed to. The
 * default is the server's git identity; any configured assignee can be
 * picked instead (remembered in localStorage).
 */
export function IdentityPicker() {
  const author = useIdentityStore((s) => s.author);
  const setAuthor = useIdentityStore((s) => s.setAuthor);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [assignees, setAssignees] = useState<Assignee[] | null>(null);

  // Load on mount and whenever the tab regains focus (git config / assignees
  // may have changed outside the browser).
  useEffect(() => {
    let cancelled = false;
    function load() {
      fetchIdentity()
        .then((id) => !cancelled && setIdentity(id))
        .catch(() => {});
      fetchConfig()
        .then((cfg) => !cancelled && setAssignees(cfg.assignees))
        .catch(() => {});
    }
    load();
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
    };
  }, []);

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
