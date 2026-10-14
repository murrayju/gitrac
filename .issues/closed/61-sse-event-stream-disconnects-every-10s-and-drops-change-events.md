---
id: 61
title: SSE event stream disconnects every ~10s and drops change events
status: done
priority: high
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T23:35:48.022Z'
createdBy: Justin Murray
updated: '2026-10-14T23:57:41.892Z'
---

Found while browser-testing #45. The `/api/events` SSE connection is torn down roughly every 10 seconds (`net::ERR_INCOMPLETE_CHUNKED_ENCODING` in the browser console, followed by a reconnect 3s later).

Cause: `Bun.serve` has a default `idleTimeout` of 10s, but `src/web/routes/events.ts` only writes to the stream every 30s (`stream.sleep(30000)` loop with no keep-alive write). Bun closes the idle connection.

Impact: any `issues-changed` event emitted while the client is disconnected is lost, so the UI misses external changes (CLI edits, agent updates, git pulls) until something else triggers a refetch. Verified: a CLI `edit -d` was never reflected in an open issue page.

## Acceptance criteria

- SSE connection stays open indefinitely: send a keep-alive comment/event well within the idle timeout (e.g. every 5s) and/or set an appropriate `idleTimeout` for the server (SSE route only if possible).
- On (re)connect the client refetches (the `connected` event should trigger a refresh), so events missed during a disconnect are never lost.
- Listener cleanup on disconnect still works (no leaked watcher listeners) — add a test.
- Test with a real `Bun.serve` instance that a client stays connected for > idleTimeout and receives an event emitted after that.

---

### Justin Murray — 2026-10-14T23:57:41.892Z

\## #61: Keep the SSE stream open and refetch on reconnect

**What was wrong**
`Bun.serve` drops a connection after 10s with no traffic (its default `idleTimeout`). `GET /api/events` only woke up every 30s and never wrote anything in between, so Bun closed the stream about every 10s. The client reconnected 3s later, and any `issues-changed` event emitted in that gap was lost. The client also never refetched on reconnect, so those missed changes stayed invisible.

**What changed**
- **`src/web/routes/events.ts`**
  - **Idle timeout:** when running under Bun, the route turns off the idle timeout for this request only (`server.timeout(req, 0)`). Every other route keeps the default.
  - **Keep-alive:** it writes a `: keep-alive` SSE comment every 5s (`SSE_KEEP_ALIVE_MS`), which also keeps proxies like the Vite dev server from closing the stream. `eventsRoute(ctx, { keepAliveMs })` lets tests change the interval.
  - **Stopping:** the loop exits when the stream is aborted, and the request's abort signal now triggers the stream's abort too.
  - **Cleanup:** the watcher listener is removed in `finally` as well as on abort, so it can't leak. No writes happen after an abort.
- **`src/web/ui/hooks.ts`:** `useSSE` now refetches on the `connected` event, which the server sends on every (re)connect. Changes made while disconnected, or between the first fetch and the stream opening, are picked up. Cost: one extra GET per hook on page load.
- **`src/web/watcher.ts`:** added `listenerCount()` so tests can check that listeners are cleaned up.
- **`docs/specs/2026-03-28-gitrac-design.md`:** documents the SSE lifecycle (`connected`, `issues-changed`, keep-alive, refetch on reconnect).
- **`src/web/routes/events.test.ts` (new):** three tests against a real `Bun.serve`:
  1. With `idleTimeout: 1`, the full app stays connected for 5.5s and still receives an `issues-changed` event triggered by a real file write afterwards.
  2. Keep-alive comments arrive on an idle stream, and real events still get through.
  3. Two clients register two listeners; closing one drops the count to 1 while the other still gets events; closing both drops it to 0.

  With the old `events.ts`, tests 1 and 2 fail. Test 3 passes either way, as intended: it guards against regressions rather than reproducing the bug.

`./bun run check` passes (549 tests).

**Decisions and trade-offs**
- **Timer granularity:** Bun checks idle timeouts on a coarse ~4s timer, so `idleTimeout` values of 4 or less drop a stream at about 4s even when it writes every 500ms. That made the keep-alive-only path impractical to test against the idle timeout itself; a meaningful test would take more than 10s. So test 2 checks that keep-alive comments are written. Separate scripts confirmed that writes do reset the timer at realistic values: default 10s with 5s keep-alives stayed up for 30s, and so did 10s/8s and 8s/2s.
- **Belt and braces:** the timeout lift alone would fix the direct case, and the keep-alive alone would fix it at Bun's default. Both are there so proxies are covered and a change to either mechanism doesn't bring the bug back.

**Follow-ups / interactions**
- The other agents' areas don't overlap: I didn't touch `server.ts`; the SSE fix lives entirely in the route via `c.env`. This relies on `startServer` passing `fetch: app.fetch` directly. If that changes to `(req) => app.fetch(req)`, the timeout lift is silently skipped and only the keep-alive is left.
- The untracked `download` symlink in the worktree was already there; it isn't part of this change.
