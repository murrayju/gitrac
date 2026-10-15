import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { findIssueRefs, issuePath } from './issue-refs.ts';
import { issueTitle, subscribeIssueTitles } from './issue-titles.ts';

/**
 * Renders `#N` issue references as links to `/issues/N` — in read-only views
 * and in editors alike — using ProseMirror inline decorations. Decorations
 * only affect the DOM: the document, and so the markdown that gets saved,
 * is never changed.
 *
 * References inside inline code, code blocks and links are left alone; the
 * matching rules within plain text are in `issue-refs.ts`.
 */

export const ISSUE_REF_ATTR = 'data-issue-ref';

export interface IssueLinksOptions {
  /**
   * In-app (client-side) navigation for a clicked reference. Without it, a
   * click opens the issue in a new tab (for composers, where navigating
   * away would drop what's being written).
   */
  navigate: ((path: string) => void) | null;
}

const issueLinksKey = new PluginKey<DecorationSet>('issueLinks');

/** Whether a text node's marks exclude it from linkification. */
function isExcluded(node: ProseMirrorNode): boolean {
  return node.marks.some(
    (mark) =>
      mark.type.spec.code === true ||
      mark.type.name === 'link' ||
      'href' in mark.attrs,
  );
}

/** Inline decorations for every `#N` reference in `doc`. */
export function issueLinkDecorations(
  doc: ProseMirrorNode,
  titleFor: (id: number) => string | undefined = issueTitle,
): DecorationSet {
  const decorations: Decoration[] = [];

  function scan(text: string, from: number) {
    for (const ref of findIssueRefs(text)) {
      const title = titleFor(ref.id);
      decorations.push(
        Decoration.inline(from + ref.start, from + ref.end, {
          nodeName: 'a',
          href: issuePath(ref.id),
          class: 'issue-ref',
          [ISSUE_REF_ATTR]: String(ref.id),
          ...(title ? { title } : {}),
        }),
      );
    }
  }

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code) return false;
    // Runs of adjacent eligible text, so `**#**3`-style mark splits match
    // like the rendered text reads; code/links/inline nodes break a run.
    let run = '';
    let runFrom = 0;
    node.forEach((child, offset) => {
      const childPos = pos + 1 + offset;
      if (child.isText && !isExcluded(child)) {
        if (!run) runFrom = childPos;
        run += child.text ?? '';
        return;
      }
      if (run) scan(run, runFrom);
      run = '';
    });
    if (run) scan(run, runFrom);
    return false;
  });

  return DecorationSet.create(doc, decorations);
}

/** The reference link `target` is in (within `view`), if any. */
function refAnchor(
  view: EditorView,
  target: EventTarget | null,
): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest(`a[${ISSUE_REF_ATTR}]`);
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  return view.dom.contains(anchor) ? anchor : null;
}

export const IssueLinks = Extension.create<IssueLinksOptions>({
  name: 'issueLinks',
  // Above Link (1000), whose click handler would otherwise `window.open`
  // any `<a>` — including these — in editable mode.
  priority: 1001,

  addOptions() {
    return { navigate: null };
  },

  addProseMirrorPlugins() {
    const { navigate } = this.options;
    return [
      new Plugin<DecorationSet>({
        key: issueLinksKey,
        state: {
          init: (_config, state) => issueLinkDecorations(state.doc),
          apply: (tr, old) =>
            tr.docChanged || tr.getMeta(issueLinksKey)
              ? issueLinkDecorations(tr.doc)
              : old,
        },
        // Refresh hover titles when newly loaded issues bring them. Not an
        // edit: `preventUpdate` keeps Tiptap from emitting `update` even if
        // another plugin appends a change (e.g. StarterKit's trailing
        // paragraph after a final code block), so nothing autosaves.
        view: (view) => {
          const unsubscribe = subscribeIssueTitles(() => {
            if (view.isDestroyed) return;
            view.dispatch(
              view.state.tr
                .setMeta(issueLinksKey, true)
                .setMeta('addToHistory', false)
                .setMeta('preventUpdate', true),
            );
          });
          return { destroy: unsubscribe };
        },
        props: {
          decorations: (state) => issueLinksKey.getState(state),
          // Claim the click so no other handler (e.g. Link's) acts on it;
          // the `click` DOM event below does the navigating.
          handleClick: (view, _pos, event) =>
            event.button === 0 && refAnchor(view, event.target) !== null,
          handleDOMEvents: {
            click: (view, event) => {
              if (event.button !== 0) return false;
              const anchor = refAnchor(view, event.target);
              if (!anchor) return false;
              const href = anchor.getAttribute('href');
              if (!href) return false;
              const modified =
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey;
              // Read-only: a real link, so the browser handles new-tab clicks
              if (modified && !view.editable) return false;
              event.preventDefault();
              // The end of a drag-select, not a click on the link
              const selection = view.dom.ownerDocument.getSelection();
              if (selection && !selection.isCollapsed) return true;
              if (navigate && !modified) {
                navigate(href);
              } else {
                window.open(href, '_blank', 'noopener');
              }
              return true;
            },
          },
        },
      }),
    ];
  },
});
