import { useCallback, useMemo, useState } from 'react';
import type { ImageUploadOptions } from '../lib/image-upload-plugin.ts';

/**
 * State for an editor's image-upload failures. `handlers` is stable, so it
 * can be passed to `ImageUpload.configure(...)` at editor creation: an upload
 * that starts clears the old message, a failing one sets it.
 */
export function useUploadError(): {
  error: string | null;
  dismiss: () => void;
  handlers: Required<ImageUploadOptions>;
} {
  const [error, setError] = useState<string | null>(null);
  const dismiss = useCallback(() => setError(null), []);
  const handlers = useMemo(
    () => ({ onError: setError, onStart: () => setError(null) }),
    [],
  );
  return { error, dismiss, handlers };
}

/** Dismissible message for a failed image upload, shown next to an editor. */
export function UploadError({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss: () => void;
}) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 my-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
    >
      <span className="flex-1 break-words">{error}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
        className="shrink-0 rounded px-1 leading-none text-red-500 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900/40 dark:hover:text-red-200"
      >
        ×
      </button>
    </div>
  );
}
