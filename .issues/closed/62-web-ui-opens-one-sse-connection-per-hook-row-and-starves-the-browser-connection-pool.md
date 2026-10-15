---
id: 62
title: >-
  Web UI opens one SSE connection per hook/row and starves the browser
  connection pool
status: done
priority: urgent
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T00:06:21.536Z'
createdBy: Justin Murray
updated: '2026-10-15T00:21:25.636Z'
---

Found while browser-testing (follow-up noted in #47). Every `useSSE()` call opens its own `EventSource('/api/events')`, and `useSSE` is called from `useIssues`, `useIssue`, `useConfig`, … — and `useConfig()` is called **in every `IssueRow`**.

With 13 issues the list page opens 15 SSE connections. Browsers allow ~6 concurrent HTTP/1.1 connections per host, so all further API requests (status/priority quick-edits, navigation fetches, git status) queue forever. Verified in Chrome: on the list page a `fetch('/api/git/status')` did not complete within 4s.

This got much worse after #61: previously the server dropped idle SSE connections every ~10s, freeing slots intermittently; now they stay open.

## Acceptance criteria

- Exactly one `EventSource` per browser tab, shared by all subscribers (module-level singleton with a subscriber set and ref-counting; reconnect logic + "refetch on connected" preserved).
- Config is fetched once and shared (context provider or a small store), not per `IssueRow`.
- Verify no component creates its own EventSource (grep), and add a unit test for the shared-subscription logic (subscribe/unsubscribe/ref-count/reconnect) that runs under bun test without a browser.
- UI build passes.

---

### Justin Murray — 2026-10-15T00:21:25.636Z

\## #62: Web UI shares one SSE connection and one config fetch per tab

**What was wrong**
Every `useSSE()` call opened its own `EventSource('/api/events')`. Each `IssueRow` called `useConfig()`, so it opened one too: 13 issues meant about 15 open SSE streams. Browsers allow only ~6 HTTP/1.1 connections per host, so later API requests (quick-edits, git status, navigation) waited forever. Every `issues-changed` event also fired one `/api/config` request per row. `IdentityPicker` fetched `/api/config` separately, as a workaround to avoid opening yet another stream.

**What changed**
- **One SSE connection per tab** (`src/web/ui/lib/event-stream.ts`): `createEventStream()` holds a set of subscribers and counts them. The connection opens on the first subscriber and is shared by all the others. If it errors, it reconnects after 3s, and subscribing during that wait doesn't open a second connection. Events from a connection that has already died are ignored. When the last subscriber leaves, it waits 1s and then closes and cancels any pending reconnect, so React StrictMode remounts and route changes don't reopen it. Every subscriber is still notified on `connected` (the refetch-on-reconnect from #61) and on `issues-changed`. `issueEvents()` is the shared instance, created on first use. The browser API is passed in, so the logic is tested under `bun test` without a browser.
- **`useSSE`** now just subscribes to `issueEvents()`. `useIssues` and `useIssue` are unchanged, so #45's protection against stale responses still applies.
- **Shared config** (`src/web/ui/lib/shared-query.ts` plus `useConfig` in `hooks.ts`): `createSharedQuery()` is a small store read with `useSyncExternalStore`. The first subscriber triggers a fetch and starts listening for changes. Simultaneous requests are merged into one. A change that arrives mid-fetch queues exactly one more fetch, and older responses never overwrite newer data. The cached value survives a remount. `useConfig()` now also returns `refetch` and `applyConfig`.
- **`IdentityPicker`** uses `useConfig()` instead of fetching itself. It still refreshes on window focus, via the shared `refetch`.
- **`AssigneePicker`** passes the `Config` returned by `updateAssignees` to `applyConfig`, so the new assignee appears straight away instead of after the SSE round-trip.

**Tests**
- `event-stream.test.ts`: 15 subscribers share one source; subscribe/unsubscribe, including unsubscribing twice; the close delay after the last subscriber; reusing the connection on quick resubscribe; reconnect after an error; cancelling a pending reconnect; one throwing listener doesn't block the others.
- `shared-query.test.ts`: one fetch and one change subscription for 13 subscribers; stable snapshots; the queued follow-up fetch; `set()` beating an older in-flight response; error handling; remounts.
- `single-connection.test.ts`: a check that scans the UI source. Only `lib/event-stream.ts` may call `new EventSource`, and only `hooks.ts` may call `fetchConfig`. It would fail against the old code.

`./bun run check` passes (635 tests), and `vite build` succeeds. The grep confirms the only `new EventSource` is in `lib/event-stream.ts`. I haven't checked it in a real browser.

**Files**
- New: `src/web/ui/lib/event-stream.ts`, `src/web/ui/lib/shared-query.ts` and their tests, `src/web/ui/lib/single-connection.test.ts`
- Changed: `src/web/ui/hooks.ts`, `src/web/ui/components/IdentityPicker.tsx`, `src/web/ui/components/AssigneePicker.tsx`
- Docs: `docs/specs/2026-03-28-gitrac-design.md` (Server section) and a new convention in `AGENTS.md`: use `useSSE`/`issueEvents()` and `useConfig()`, never `new EventSource` or `fetchConfig()` directly.

**Trade-offs**
- When the shared connection opens, its `connected` event arrives while the first config fetch is still running. That queues one more config fetch on page load, which is safe and costs one request.
- A component that subscribes to an already-open stream gets no `connected` event. Hooks fetch on mount anyway, so nothing is missed.

**Follow-ups noticed (not done)**
- `useIssues` has no protection against out-of-order responses, unlike `useIssue`. A burst of SSE events can still let an older list response overwrite a newer one.
- `useGitStatus` and `useDrafts` aren't shared either, though they don't open streams.
- There's an untracked `download` symlink in the worktree. It was there before; I didn't create it.

**Orchestrator browser verification (Chrome, 13-issue list):** before: 15 concurrent `/api/events` connections, `fetch('/api/git/status')` blocked >4s. After: a single `/api/events` connection across list → detail → back navigation, API probe 70ms, config fetched once per change (not per row), and an external CLI rename appears in the list via SSE.
