/**
 * Reconciling the description editor with server-side changes (#45).
 *
 * The editor tracks the server state its content is based on (`base`). When
 * a newer server state arrives (SSE refetch, or the `current` issue in a 409
 * response) we decide what to do without ever silently overwriting either
 * side.
 */

import { sameDescription } from '../../../core/description.ts';

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

/**
 * What the editor last loaded: the server text it was given (`text`) and
 * the editor's own serialization of it right after loading (`markdown`),
 * which can differ in form only (`*` vs `-` bullets, escaping...).
 */
export interface LoadedContent {
  text: string;
  markdown: string | null;
}

/**
 * Whether the editor's `markdown` needs saving on top of `base` (#90). Not
 * when it is the same markdown as the base description (only surrounding
 * whitespace differs, e.g. the empty paragraph Tiptap appends after a final
 * code block when clicked into), nor when it is exactly the editor's own
 * serialization of the base as loaded (the user changed nothing; saving
 * would only reformat it).
 */
export function needsSave(
  markdown: string,
  base: DocVersion,
  loaded: LoadedContent | null,
): boolean {
  if (sameDescription(markdown, base.text)) return false;
  if (
    loaded?.markdown != null &&
    sameDescription(loaded.text, base.text) &&
    sameDescription(markdown, loaded.markdown)
  ) {
    return false;
  }
  return true;
}
