---
id: 77
title: 409 conflict responses don't include claimedElsewhere
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T16:07:01.091Z'
createdBy: Justin Murray
updated: '2026-10-15T20:23:22.692Z'
---

Since #66, `GET /api/issues/:id` and mutation responses include an optional `claimedElsewhere`. The `current` issue embedded in 409 responses (If-Match conflicts, `invalid_state`, `duplicate_issue`) doesn't, so the UI briefly drops the badge until its next refetch.

## Acceptance criteria

- Every response that embeds an issue (`current` in 409s included) uses the same decoration as GET.
- Tests.

---

### Justin Murray — 2026-10-15T20:23:22.692Z

**Fix for #77: 409 responses (and DELETE responses) now include `claimedElsewhere`**

**What was wrong**
Since #66, `GET /api/issues/:id` and mutation responses add `claimedElsewhere` to the issue they return. The `current` issue inside 409 responses was still sent bare. That covers both the `If-Match` mismatch and `invalid_state` (already closed / already open). So the UI dropped the "claimed elsewhere" badge until its next refetch. `DELETE /api/issues/:id`, including `?dryRun=1`, had the same gap in its `issue` field.

The issue also lists `duplicate_issue` 409s, but those only carry `{ error, code, files }` and never contained an issue, so nothing changed there.

**What changed**
- **`src/web/routes/issues.ts`**
  - `errorResponse` is now async and takes the `ServerContext`. It runs `current` through `withClaim`, the same decoration GET uses (the server's short-lived cached scan, not a fresh one per request), for both the If-Match 409 and the `invalid_state` 409.
  - The DELETE route does the same for its `issue` field, for real deletes and dry runs.
  - All three callers were updated.
- **`src/web/ui/api.ts`**: types only. `ConflictError.current` and `IssueDeletion.issue` are now `ApiIssue` (an `Issue` with the optional `claimedElsewhere`).
- **`src/web/routes/issues-elsewhere.test.ts`**: two regression tests.
  - With a claim in another worktree, the 409 `current` from a stale-`If-Match` PATCH, a stale-`If-Match` DELETE and an `invalid_state` reopen each equal the GET body. An issue with no claim elsewhere has no field.
  - Both DELETE forms (dry run and real) return the decorated `issue`.
  - Both tests fail against the old `issues.ts` and pass now.
- **`docs/specs/2026-03-28-gitrac-design.md`**: the "Claims elsewhere" text now says every response that embeds an issue carries `claimedElsewhere`, including a 409's `current` and a DELETE's `issue`.

**Decisions / trade-offs**
- **Real deletes:** I decorated the returned `issue` here too, for consistency. The local file is gone, but a claim on another branch or worktree still exists and is worth reporting.
- **Response timing:** each 409 or DELETE response may now wait on the cached scan, at most one scan per 5s TTL, the same cost GET already has.

**Follow-ups noticed (not fixed)**
- In the UI, the mutation helpers in `api.ts` (`createIssue`, `updateIssue`, comments, close, reopen) are still typed as returning `Issue`. The server already sends `claimedElsewhere` on those responses, so this is only a typing gap.

`./bun run check` passes (typecheck, lint, all 1251 tests).
