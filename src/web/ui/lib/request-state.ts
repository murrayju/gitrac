import { requestErrorReason } from './upload-error.ts';

/** Where a form shows the state of one request. */
export interface RequestStateSetters {
  /** `true` while the request runs, `false` when it settles. */
  setBusy: (busy: boolean) => void;
  /** The failure reason, or `null` when a new request starts. */
  setError: (error: string | null) => void;
}

/**
 * Run `action` (a save, a post) for a form. Busy stays `true` until the
 * action settles. A rejection becomes the error text, so it is shown and is
 * never left unhandled. Returns `true` if the action succeeded.
 */
export async function trackRequest(
  action: () => Promise<unknown>,
  { setBusy, setError }: RequestStateSetters,
): Promise<boolean> {
  setBusy(true);
  setError(null);
  try {
    await action();
    return true;
  } catch (e) {
    setError(requestErrorReason(e));
    return false;
  } finally {
    setBusy(false);
  }
}
