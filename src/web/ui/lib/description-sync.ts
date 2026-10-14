/**
 * Reconciling the description editor with server-side changes (#45).
 *
 * The editor tracks the server state its content is based on (`base`). When
 * a newer server state arrives (SSE refetch, or the `current` issue in a 409
 * response) we decide what to do without ever silently overwriting either
 * side.
 */

/** A description as stored on the server, at a given issue version (ETag). */
export interface DocVersion {
  version: string | null;
  text: string;
}

/**
 * - `none`: nothing changed.
 * - `rebase`: the issue changed but not its description (e.g. a comment or a
 *   status change) — adopt the new version, keep the editor as is.
 * - `replace`: the description changed and the editor has no unsaved edits —
 *   load the new text into the editor.
 * - `conflict`: the description changed while the editor has unsaved edits —
 *   tell the user instead of overwriting anything.
 */
export type ReconcileAction = 'none' | 'rebase' | 'replace' | 'conflict';

export function reconcileIncoming(
  base: DocVersion,
  incoming: DocVersion,
  dirty: boolean,
): ReconcileAction {
  // Same version = same file on disk; nothing to do
  if (incoming.version !== null && incoming.version === base.version) {
    return 'none';
  }
  if (incoming.text === base.text) {
    return incoming.version === base.version ? 'none' : 'rebase';
  }
  return dirty ? 'conflict' : 'replace';
}
