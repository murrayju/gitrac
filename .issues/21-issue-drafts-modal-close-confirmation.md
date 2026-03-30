---
id: 21
title: 'Issue drafts, modal close confirmation'
status: in_progress
priority: medium
assignee: Justin Murray
labels:
  - feature
created: '2026-03-30T00:34:48.918Z'
createdBy: web
updated: '2026-03-30T01:26:38.256Z'
---

Currently, when filling out the new issue modal, if you close it (whether accidental or intentional), all your progress is lost. Instead, (debounced) edits should be implicitly persisted in a drafts folder (use a timestamp for the filename). This way, even if you hard-reload the tab, it'll survive.

Closing the modal should show a confirmation like Linear's

![image.png](/api/issues/assets/jYJBTsc6v6WJFaLI5MT8m.png)Choosing `Discard` will delete from the drafts folder.

When drafts are present, show a link to a drafts page in the sidebar

![image.png](/api/issues/assets/-xwBkn7x2wrya8gNUexWC.png)This page should list the drafts similar to the issues list. Clicking on one should reopen the modal, with the previous content loaded.

---

### Justin Murray — 2026-03-30T01:26:38.256Z

Implemented issue drafts and modal close confirmation feature:

**Backend** (src/web/routes/drafts.ts):
- New REST API for draft CRUD: GET /api/drafts (list), PUT /api/drafts/:filename (save), DELETE /api/drafts/:filename (delete)
- Drafts stored as JSON files in .issues/drafts/ (gitignored)
- Registered in server.ts alongside existing routes

**Frontend API & Hooks** (api.ts, hooks.ts):
- Added Draft type, fetchDrafts(), saveDraft(), deleteDraft() API functions
- Added useDrafts() hook with loading state and refresh callback

**CreateIssueModal** (CreateIssueModal.tsx):
- Accepts optional initialDraft prop to pre-populate form from a saved draft
- Auto-saves draft to backend via debounced (1s) API calls using useEffect + useRef
- Close confirmation dialog shown when modal has content and user tries to close (Escape, backdrop click, X button)
- Three options: Delete draft (red/destructive), Cancel (back to modal), Save draft (primary)
- On successful issue creation, automatically deletes the associated draft file
- onClose callback now includes a reason parameter ('submitted' | 'deleted' | 'saved')

**Layout** (Layout.tsx):
- Added LayoutContext to expose openCreateModal() and refreshDrafts() to child components
- Drafts nav link with count badge shown when drafts exist
- Modal state tracks optional draft for pre-population
- Draft count refreshes after modal close actions

**DraftList page** (DraftList.tsx):
- New page at /drafts listing all drafts in a table (title, priority, last saved time)
- Click opens create modal pre-populated with draft content
- Delete button per row to remove drafts
- Uses useLayout() context to open modal and refresh sidebar count

**App.tsx**: Added /drafts route
**.gitignore**: Added .issues/drafts/ to prevent drafts from being committed
