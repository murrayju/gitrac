---
id: 74
title: 'Linkify #N issue references in the web UI'
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-15T16:06:58.415Z'
createdBy: Justin Murray
updated: '2026-10-15T17:51:20.271Z'
---

The spec says cross-references use `#N` syntax, but the web UI renders `#3` as plain text in descriptions and comments.

## Acceptance criteria

- `#N` (word-boundary, not inside code spans/blocks or URLs/headings anchors) renders as a link to `/issues/N` in read-only markdown and comments. Show the issue title on hover if cheaply available from loaded data.
- The stored markdown is unchanged (rendering only). In the Tiptap editor, linkification must not alter the saved markdown.
- Unit tests for the matching rules.

---

### Justin Murray — 2026-10-15T17:51:20.271Z

\## #74: `#N` issue references are now links in the web UI

**What was wrong:** The spec says issues cross-reference each other with `#N`, but the web UI showed `#3` as plain text in descriptions and comments.

**What changed:** `#N` now shows as a link to `/issues/N` everywhere markdown appears: read-only views, comments, the description editor and the comment/new-issue editors. Only the display changes, never the saved markdown. The links are ProseMirror inline decorations (a display-only overlay), so the document isn't touched. `./bun run check` and the Vite build both pass. I also checked it by hand in Chrome against a scratch repo:
- The description, heading and comment refs were linked; refs in inline code, code blocks and URLs were not.
- Hovering showed the issue title.
- Clicking navigated client-side with no page reload.
- Loading the page made no commit.

**Matching rules** (`lib/issue-refs.ts`):
- A ref is `#` followed by a positive number with no leading zero.
- It must stand alone: no letter, digit, `_`, `#`, `&` or `/` right before it (so not `abc#3`, `##3`, `&#38;`, `/#3`). No word character right after, and no `-` or `.` followed by one (so not `#3a`, `#3.5`, `#3-setup`). Trailing punctuation is fine: `(#3)`, `#3.`.
- It's skipped inside bare URLs (`https://x/page#3`), inline code, code blocks and links.
- `#N` inside headings is linked.
- A ref split by formatting (`**#**3`) still matches.

**Hover titles:** these come from a small in-memory cache, `lib/issue-titles.ts`. It's filled from data the UI already loads: the issue list, the open issue and its linked issues. Nothing extra is fetched, so a ref to an issue that hasn't been loaded has no title. When new titles arrive, the links refresh without changing the document and without counting as an edit.

**Clicking:**
- **Read-only views and the description editor:** a click navigates in-app with react-router. In read-only views, Ctrl/Cmd/Shift/Alt-click is left to the browser (new tab).
- **Composers (new comment, comment edit, new issue):** a click opens the issue in a new tab, so an unsent draft isn't lost.
- **Drag-selecting** across a link doesn't follow it.
- **Link-extension conflict:** the plugin is set to run before Tiptap's Link extension, which would otherwise open every `<a>`, including these, in a new window.

**Files**
- New in `src/web/ui/lib/`: `issue-refs.ts`, `issue-titles.ts`, `issue-link-plugin.ts`, `use-issue-links.ts`, plus `issue-refs.test.ts` and `issue-link-plugin.test.ts`.
- Edited in `src/web/ui/components/`: `MarkdownContent.tsx` and `CommentList.tsx` (read-only views); `IssueEditor.tsx` (new `issueLinksInApp` prop), `DescriptionEditor.tsx` (passes it), `CommentEditor.tsx`.
- `src/web/ui/hooks.ts`: fills the title cache.
- `docs/specs/2026-03-28-gitrac-design.md`: the `#N` bullet and a new "Issue references" paragraph under React UI.
- `package.json` / `bun.lock`: new dev dependency `@happy-dom/global-registrator`.

**Tests:**
- Unit tests cover the matching rules.
- Editor tests (in a fake DOM) cover:
  - which contexts get linked;
  - `getEditorMarkdown` and `getJSON` match an editor without the plugin, and a simple document round-trips exactly;
  - a title refresh fires no `update` event and adds no undo step, even when the description ends in a code block;
  - links follow typing;
  - the click behaviours above.
- Without the fix, the tests fail.

**Trade-offs**
- **Clicking a ref in the description editor follows it** instead of placing the cursor, the same as Tiptap's default for ordinary links. To edit `#3`, click just outside it or use the keyboard.
- **New dev dependency (happy-dom):** Tiptap and tiptap-markdown can't build an editor without a DOM. The test sets up the fake DOM in `beforeAll` and removes it in `afterAll`, so other test files aren't affected.

**Follow-up noticed (not fixed, already happens without this change):** clicking anywhere in a description that ends in a code block (or other non-paragraph block) makes StarterKit add an empty trailing paragraph. That counts as an edit, so it triggers a no-op autosave and an `issue: edit #N` commit that only changes `updated`. I first hit this through my own title refresh; that path is now fixed by setting Tiptap's `preventUpdate` flag on the refresh. Ordinary clicks and selections still cause it, and it's probably worth its own issue.

**Orchestrator browser verification:** on the demo repo, `#3` inside a comment renders as a link to `/issues/3`, clicking it navigates client-side to #3, and viewing/clicking produced no commit.
