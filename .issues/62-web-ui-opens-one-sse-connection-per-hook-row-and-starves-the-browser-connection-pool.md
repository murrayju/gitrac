---
id: 62
title: >-
  Web UI opens one SSE connection per hook/row and starves the browser
  connection pool
status: in_progress
priority: urgent
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T00:06:21.536Z'
createdBy: Justin Murray
updated: '2026-10-15T00:06:22.328Z'
---

Found while browser-testing (follow-up noted in #47). Every `useSSE()` call opens its own `EventSource('/api/events')`, and `useSSE` is called from `useIssues`, `useIssue`, `useConfig`, … — and `useConfig()` is called **in every `IssueRow`**.

With 13 issues the list page opens 15 SSE connections. Browsers allow ~6 concurrent HTTP/1.1 connections per host, so all further API requests (status/priority quick-edits, navigation fetches, git status) queue forever. Verified in Chrome: on the list page a `fetch('/api/git/status')` did not complete within 4s.

This got much worse after #61: previously the server dropped idle SSE connections every ~10s, freeing slots intermittently; now they stay open.

## Acceptance criteria

- Exactly one `EventSource` per browser tab, shared by all subscribers (module-level singleton with a subscriber set and ref-counting; reconnect logic + "refetch on connected" preserved).
- Config is fetched once and shared (context provider or a small store), not per `IssueRow`.
- Verify no component creates its own EventSource (grep), and add a unit test for the shared-subscription logic (subscribe/unsubscribe/ref-count/reconnect) that runs under bun test without a browser.
- UI build passes.
