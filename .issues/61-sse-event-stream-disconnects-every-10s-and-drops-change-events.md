---
id: 61
title: SSE event stream disconnects every ~10s and drops change events
status: todo
priority: high
assignee: ''
labels:
  - bug
created: '2026-10-14T23:35:48.022Z'
createdBy: Justin Murray
updated: '2026-10-14T23:35:48.022Z'
---

Found while browser-testing #45. The `/api/events` SSE connection is torn down roughly every 10 seconds (`net::ERR_INCOMPLETE_CHUNKED_ENCODING` in the browser console, followed by a reconnect 3s later).

Cause: `Bun.serve` has a default `idleTimeout` of 10s, but `src/web/routes/events.ts` only writes to the stream every 30s (`stream.sleep(30000)` loop with no keep-alive write). Bun closes the idle connection.

Impact: any `issues-changed` event emitted while the client is disconnected is lost, so the UI misses external changes (CLI edits, agent updates, git pulls) until something else triggers a refetch. Verified: a CLI `edit -d` was never reflected in an open issue page.

## Acceptance criteria

- SSE connection stays open indefinitely: send a keep-alive comment/event well within the idle timeout (e.g. every 5s) and/or set an appropriate `idleTimeout` for the server (SSE route only if possible).
- On (re)connect the client refetches (the `connected` event should trigger a refresh), so events missed during a disconnect are never lost.
- Listener cleanup on disconnect still works (no leaked watcher listeners) — add a test.
- Test with a real `Bun.serve` instance that a client stays connected for > idleTimeout and receives an event emitted after that.
