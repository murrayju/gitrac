import { useCallback, useEffect, useRef, useState } from 'react';
import type { Issue } from '../../../core/types.ts';
import { ConflictError, updateIssueVersioned } from '../api.ts';
import { type DocVersion, reconcileIncoming } from '../lib/description-sync.ts';
import { IssueEditor, type IssueEditorHandle } from './IssueEditor.tsx';
import { MarkdownContent } from './MarkdownContent.tsx';

/**
 * Auto-saving issue description editor that never silently clobbers changes
 * made elsewhere (CLI, agents, git pull, another tab).
 *
 * Saves are sent with `If-Match: <version the editor is based on>` and are
 * serialized (one in flight at a time). External changes to the description
 * are loaded into the editor when it has no unsaved edits; otherwise a
 * conflict notice lets the user pick a side.
 */
export function DescriptionEditor({
  issueId,
  description,
  version,
  onSaved,
}: {
  issueId: number;
  /** Description of the latest fetched issue. */
  description: string;
  /** Version (ETag) of the latest fetched issue. */
  version: string | null;
  /** Called with the server's response after each successful save. */
  onSaved: (issue: Issue, version: string | null) => void;
}) {
  const editorRef = useRef<IssueEditorHandle>(null);
  // Server state the editor content is based on
  const baseRef = useRef<DocVersion>({ version, text: description });
  // Unsaved edits = edits made after the last successfully saved one
  const editGenRef = useRef(0);
  const savedGenRef = useRef(0);
  const savingRef = useRef(false);
  const pendingRef = useRef<string | null>(null);
  const conflictRef = useRef<DocVersion | null>(null);
  const [conflict, setConflictState] = useState<DocVersion | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const setConflict = useCallback((next: DocVersion | null) => {
    conflictRef.current = next;
    setConflictState(next);
  }, []);

  const save = useCallback(
    async (markdown: string): Promise<void> => {
      // One save at a time; hold edits while a conflict is unresolved
      if (savingRef.current || conflictRef.current) {
        pendingRef.current = markdown;
        return;
      }
      savingRef.current = true;
      const gen = editGenRef.current;
      try {
        const { data, version: newVersion } = await updateIssueVersioned(
          issueId,
          { description: markdown },
          baseRef.current.version,
        );
        baseRef.current = { version: newVersion, text: data.description };
        savedGenRef.current = gen;
        setSaveError(null);
        onSavedRef.current(data, newVersion);
      } catch (e) {
        if (e instanceof ConflictError) {
          // Retry (or hold) the newest content we have
          pendingRef.current ??= markdown;
          const incoming = { version: e.version, text: e.current.description };
          if (reconcileIncoming(baseRef.current, incoming, true) === 'rebase') {
            // Only other fields changed (comment, status...): retry on top
            baseRef.current = incoming;
          } else {
            setConflict(incoming);
          }
        } else {
          // Edits typed during this save (if any) are retried below
          setSaveError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        savingRef.current = false;
      }
      const next = pendingRef.current;
      if (next !== null && !conflictRef.current) {
        pendingRef.current = null;
        await save(next);
      }
    },
    [issueId, setConflict],
  );

  // React to newer server state (SSE refetches, other tabs, our own saves)
  useEffect(() => {
    // An in-flight save settles the base itself; its response triggers a
    // fresh fetch, so nothing seen meanwhile is lost.
    if (savingRef.current) return;
    const incoming = { version, text: description };
    const dirty = editGenRef.current !== savedGenRef.current;
    const action = reconcileIncoming(baseRef.current, incoming, dirty);
    if (action === 'none') return;
    if (action === 'conflict') {
      setConflict(incoming);
      return;
    }
    baseRef.current = incoming;
    if (action === 'replace') {
      editorRef.current?.setContent(incoming.text);
    }
    if (conflictRef.current) {
      // Description went back to what we were based on: no conflict anymore
      setConflict(null);
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next !== null) void save(next);
    }
  }, [version, description, save, setConflict]);

  function loadTheirs() {
    const theirs = conflictRef.current;
    if (!theirs) return;
    baseRef.current = theirs;
    editorRef.current?.setContent(theirs.text);
    savedGenRef.current = editGenRef.current;
    pendingRef.current = null;
    setConflict(null);
  }

  function keepMine() {
    const theirs = conflictRef.current;
    if (!theirs) return;
    // Base the overwrite on the version we've now seen
    baseRef.current = theirs;
    pendingRef.current = null;
    setConflict(null);
    void save(editorRef.current?.getMarkdown() ?? '');
  }

  return (
    <div>
      {conflict && (
        <div
          role="alert"
          className="mb-2 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <p>
            The description was changed elsewhere while you were editing. Your
            edits are not saved yet.
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer">Show the other version</summary>
            <div className="mt-1 rounded border border-amber-300 bg-white px-3 py-2 dark:border-amber-800 dark:bg-gray-900">
              <MarkdownContent key={conflict.version} content={conflict.text} />
            </div>
          </details>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={loadTheirs}
              className="px-2 py-1 rounded border border-amber-400 hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/40"
            >
              Discard mine, load theirs
            </button>
            <button
              type="button"
              onClick={keepMine}
              className="px-2 py-1 rounded border border-amber-400 hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/40"
            >
              Keep mine, overwrite theirs
            </button>
          </div>
        </div>
      )}
      {saveError && (
        <div role="alert" className="mb-2 text-sm text-red-500">
          Failed to save description: {saveError}
        </div>
      )}
      <IssueEditor
        ref={editorRef}
        content={description}
        issueLinksInApp
        onEdit={() => {
          editGenRef.current++;
        }}
        onChange={(md) => void save(md)}
      />
    </div>
  );
}
