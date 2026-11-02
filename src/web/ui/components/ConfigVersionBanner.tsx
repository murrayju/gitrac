import { useEffect } from 'react';
import { configVersionWarning } from '../../../core/config.ts';
import { useConfig } from '../hooks.ts';

/**
 * A banner over every page while `.issues/config.yaml` is newer than this
 * gitrac knows (`configVersionWarning`); also logged to the browser console.
 */
export function ConfigVersionBanner() {
  const { config } = useConfig();
  const warning = configVersionWarning(config?.version);
  useEffect(() => {
    if (warning) console.warn(`gitrac: ${warning}`);
  }, [warning]);
  if (!warning) return null;
  return (
    <div
      role="alert"
      className="bg-red-700 border-b border-red-900 px-4 py-2 text-sm text-white"
      data-testid="config-version-banner"
    >
      {warning}
    </div>
  );
}
