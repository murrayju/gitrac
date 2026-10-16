import { ApiError } from '../api.ts';

/** Longest raw (non-JSON) server response we'll show verbatim. */
const MAX_RAW_BODY = 200;

/**
 * The server's own message for a failed request: the `error` field of a JSON
 * body (`{"error": "Unsupported file type: .svg"}`), else a short plain-text
 * body, else nothing (e.g. an HTML error page from a proxy).
 */
function serverMessage(body: string): string | undefined {
  const text = body.trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const error = (parsed as { error: unknown }).error;
      if (typeof error === 'string' && error.trim()) return error.trim();
      if (error && typeof error === 'object' && 'message' in error) {
        const message = (error as { message: unknown }).message;
        if (typeof message === 'string' && message.trim()) {
          return message.trim();
        }
      }
    }
    return undefined;
  } catch {
    // not JSON
  }
  if (text.startsWith('<') || text.length > MAX_RAW_BODY) return undefined;
  return text;
}

/**
 * Why a request failed (an upload, a link change, ...): the server's message
 * if it sent one, else a short generic reason.
 */
export function requestErrorReason(err: unknown): string {
  if (err instanceof ApiError) {
    const message = serverMessage(err.body);
    if (message) return message;
    if (err.status === 413) return 'File is too large';
    return `Server error (HTTP ${err.status})`;
  }
  // fetch() rejects with a TypeError when the request never got a response.
  if (err instanceof TypeError) {
    return 'Network error: could not reach the server';
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Unknown error';
}

/**
 * User-facing message for a failed image upload (`uploadAsset` rejection),
 * preferring the server's error text.
 */
export function uploadErrorMessage(err: unknown, fileName?: string): string {
  const prefix = fileName
    ? `Couldn't upload "${fileName}"`
    : "Couldn't upload image";
  return `${prefix}: ${requestErrorReason(err)}`;
}
