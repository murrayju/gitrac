---
id: 104
title: 'Web UI: add search, label filter, mine filter, and dependency editing'
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-16T12:13:30.127Z'
createdBy: Justin Murray
updated: '2026-10-16T20:19:54.645Z'
---

The backend (`GET /api/issues`, `POST /api/issues/:id/link`, `POST /api/issues/:id/unlink`) and `src/web/ui/api.ts` already support `search`, `label`, and `mine` filters and link mutations, but the web UI does not expose them:

- `IssueList.tsx` and `filterStore.ts` only provide Status, Priority, and Assignee dropdowns (no search input, label filter, or "Mine" toggle).
- `DependenciesPanel.tsx` is read-only ("Edit links with `gitrac link` / `gitrac unlink`"), with no way to add or remove `blockedBy` or `parent` links in the browser.

## Acceptance criteria

- Add search input, label filter, and "Mine" filter to `IssueList.tsx` (persisted in `filterStore.ts`).
- Add UI controls in `DependenciesPanel.tsx` (or `MetadataPanel.tsx`) to add and remove `blockedBy` and `parent` links via `POST /api/issues/:id/link` and `/unlink`, surfacing validation/cycle errors cleanly.
- Tests.

---

### Justin Murray — 2026-10-16T20:19:54.259Z

Search, label and "Mine" filters are now in the issue list, and you can edit blocked-by and parent links in the dependencies panel. Typecheck, lint, `./bun test src/web --only-failures` (386 pass) and the Vite build all pass.

\## What was wrong
The API (`GET /api/issues` with `search`, `label`, `mine`, and `POST /api/issues/:id/link` / `unlink`) already supported these, but the web UI didn't show them:
- `IssueList.tsx` only had Status, Priority and Assignee dropdowns.
- `DependenciesPanel.tsx` was read-only, and it was hidden when an issue had no links, so you couldn't add the first one.

\## What changed
- **List filters** (`IssueList.tsx`, `stores/filterStore.ts`)
  - A search box, sent as `search` 250 ms after the last keystroke.
  - A Label dropdown listing the labels in the config, sent as `label`.
  - A "Mine" checkbox, sent as `mine=1`. Its tooltip says it uses the **server's git identity**, not the identity picked in the UI.
  - These are kept in `filterStore` alongside the existing filters. Sorting is still done in the browser.
- **`lib/list-filters.ts`** (new): turns the store's selections into the request filters (trims search, drops empty values) and builds the label options. If the selected label was removed from the config, it stays in the list so the dropdown can still show it.
- **`api.ts`**: added `linkIssue` and `unlinkIssue`. The query-string building moved out of `fetchIssues` into `issueListQuery` so it can be tested; behavior is the same.
- **`DependenciesPanel.tsx`**
  - The panel always shows once its data has loaded.
  - **Parent:** when set, an `×` clears it; when not set, an input accepts `12` or `#12` and a "Set" button saves it.
  - **Blocked by:** each blocker has an `×`; an input accepts a list such as `#3, #4` and an "Add" button saves it.
  - Typos are caught in the browser before anything is sent. Server 400 messages (missing issue, linking an issue to itself, cycle) show inline in the panel.
  - The panel refetches after every change; the live-update event also arrives.
  - Sub-issues and "Blocks" stay read-only, because they come from other issues' files.
- **`lib/issue-id-input.ts`** (new): parses `#12`, `12` and lists of IDs, and rejects `0`, leading zeros, junk, and more than one ID for the parent.
- **`lib/upload-error.ts`**: renamed the private `reason()` to `requestErrorReason()` and exported it, so the panel shows server errors the same way image uploads do. Upload messages are unchanged.
- **`hooks.ts`**: `useIssueDependencies` now also returns `refetch`.
- **Design spec** (`docs/specs/2026-03-28-gitrac-design.md`): the List View and Detail View sections describe the new filters, what "Mine" means, and dependency editing.

\## Tests
- `lib/issue-id-input.test.ts`: valid and invalid IDs, lists, sorting and removing duplicates, the single-ID rule for the parent.
- `lib/list-filters.test.ts`: mapping selections to request filters and the query string (`mine=1`, URL-encoding, blank search), and the label options.
- `api-links.test.ts`: runs the real `linkIssue`, `unlinkIssue` and `fetchIssues` against the real issue routes, with `fetch` redirected to an in-process server. It covers adding and removing blockers, setting and clearing the parent, the exact cycle and missing-issue messages, and the search, label and mine filters.

\## Decisions and trade-offs
- The label filter picks one label, as you suggested. The API also accepts several separated by commas if we want multi-select later.
- Changing an existing parent means clearing it first, then setting the new one. This keeps the panel simple.
- Filters last for the browser session only, like the existing ones; they are not saved in `localStorage`.
- I didn't edit `MetadataPanel.tsx` or `CommentList.tsx`.

\## Follow-ups
- "Mine" ignores the identity picked in the UI. Making it follow that choice would need the server to accept an identity parameter.
- The issue picker only takes numbers. Searching issues by title would be nicer.
- Link changes don't send `If-Match`. Each link change is a small merge done on the server, so the risk of overwriting someone's edit is low, but it differs from description edits.

**Orchestrator browser verification** (scratch repo, Chrome): search `auth` matched #2 and #3 (`?search=auth`), the label filter sent `label=bug`, Mine sent `mine=1` and showed only the issue claimed by the server identity, and clearing the search box restored the list. In the dependencies panel, setting parent `#2` and adding blocker `1` persisted (one amended `issue: link #3` commit; `gitrac show 3 -o json` shows `parent: 2, blockedBy: [1]`), adding `#3` showed "Issue #3 can't be blocked by itself" inline, and "Remove blocker #1" cleared it.
