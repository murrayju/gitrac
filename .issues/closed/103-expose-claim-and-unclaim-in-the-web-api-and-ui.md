---
id: 103
title: Expose claim and unclaim in the web API and UI
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
blockedBy:
  - 93
  - 94
created: '2026-10-16T12:13:29.051Z'
createdBy: Justin Murray
updated: '2026-10-16T21:02:59.842Z'
---

The CLI provides `gitrac claim <id>` and `gitrac unclaim <id>` (backed by `claimIssue` and `unclaimIssue` in `src/service/claim.ts`), which enforce exclusive claims across worktrees and branches and register new assignees.

The web API and UI currently have no `claim` or `unclaim` endpoints or controls. Worse, setting status to `in_progress` and assigning an issue in the web UI calls `PATCH /api/issues/:id` (`updateIssue`), which bypasses `decideClaim` and can silently overwrite an active claim held by an agent in another worktree.

## Acceptance criteria

- Add `POST /api/issues/:id/claim` and `POST /api/issues/:id/unclaim` routes in `src/web/routes/issues.ts` routing through `claimIssue` / `unclaimIssue` (accepting optional `author`, `comment`, `force`, and mapping `already_claimed` / `issue_closed` to 409 with details).
- Add Claim / Unclaim actions in the web UI (`IssueDetail` / `MetadataPanel`) that respect the selected "Acting as" identity and surface claim conflicts clearly.
- Tests for the new API routes and surface parity.

---

### Justin Murray — 2026-10-16T21:02:59.467Z

\## Summary: claim and unclaim in the web API and UI

The web UI can now claim and release issues using the same rules as `gitrac claim` / `gitrac unclaim`. Typecheck and lint are clean (0 warnings, 0 errors), `./bun test src/web src/service` passes (599 tests), the Vite build succeeds, and the CLI claim tests still pass.

\### What was wrong
The CLI's `claim` / `unclaim` (`claimIssue` / `unclaimIssue`) only let one person hold an issue at a time, across worktrees and branches. The web API and UI had no claim endpoints. The only way to "claim" in the UI was to set the status and assignee, which goes through `PATCH /api/issues/:id`. That path skips `decideClaim`, so it could silently overwrite a claim an agent held in another worktree.

\### What changed
- **Service (`src/service/claim.ts`):** `ClaimOptions` takes an optional `precondition` that is passed to `loadStoredIssue`, as other service operations already do. This is only for `If-Match`. The claim decisions and `src/core/` are unchanged.
- **Who claims (`src/web/service-context.ts`):** `webServiceContext(ctx, { author })` takes an optional author. `actingIdentity` checks it with `authorError`, then picks the configured assignee with that name (name plus their email). If no assignee matches but the name is the server's own identity, that is used. Any other name is a 400 `invalid_input`. With no author, the server identity is used as before.
- **Routes (`src/web/routes/issues.ts`):** new `POST /api/issues/:id/claim` and `/unclaim`.
  - Body is `{ author?, comment?, force? }`, with type checks (400).
  - They sit behind `mutationLock`, run through `mutateIssue`, so they honor `If-Match` and reply via `respondWithIssue` with an ETag and `claimedElsewhere` / `closedElsewhere`.
  - A no-op is a 200 with the current issue.
  - `errorResponse` now maps `already_claimed` to 409 `{ error, code, assignee, claimedElsewhere? }` and `issue_closed` to 409 `{ error, code, status, closedElsewhere? }`.
- **UI:**
  - `api.ts` has `claimIssue` / `unclaimIssue`, sent with `If-Match`.
  - `lib/claim.ts` has three helpers: `actingUser` (works out the "Acting as" user), `claimActions` (which buttons to show; uses the issue's state elsewhere and the configured active status, never hard-coded names) and `claimConflict` (reads a 409 refusal).
  - New `ClaimControls.tsx` sits under the assignee in `MetadataPanel`. "Claim" shows when the issue is open and is not the acting user's active claim. "Release" shows when the issue is assigned. A refusal shows the server's message inline, with "Take over" / "Release anyway" (`force`) for `already_claimed`. If the issue changed since it was loaded (409), the latest version is applied and the user is asked to try again. Results are shown through `applyIssue`.
  - The server identity fetch is now one shared query (`useServerIdentity` in `hooks.ts`), used by both `IdentityPicker` and the claim buttons.
- **Docs:** two rows in the API table and the Detail View text in `docs/specs/2026-03-28-gitrac-design.md`. A paragraph in `skills/using-gitrac/SKILL.md` says humans can claim from the web UI.

\### Tests
- **`src/web/routes/issues-claim.test.ts` (18 tests, real git worktree fixture):** covers:
  - claim plus the commit message and assignee registration
  - no-op
  - someone else's claim, then force
  - closed issue, then force reopen
  - claimed and closed in another worktree (`claimedElsewhere` / `closedElsewhere`), plus force takeover or release
  - author selection, unknown or invalid author (400), bad body and bad or missing ID, `If-Match`
  - the same cases for unclaim

  All 18 fail without the change.
- **`src/web/surface-parity.test.ts`:** claim / unclaim commit message, committed files and error codes match the CLI.
- **`src/web/ui/lib/claim.test.ts` (12 tests):** unit tests for the UI helpers, including a custom active status.

\### Decisions and trade-offs
- **Server identity name accepted as `author`:** besides configured assignees, `author` can also be the server identity's own name. The UI never sends that (`effectiveAuthor` leaves it out), but it keeps the API forgiving.
- **Claim shown on someone else's claim:** the UI shows both "Claim" and "Release" when someone else holds the issue, and lets the server's 409 explain who holds it before offering a takeover. It never sends `force` on the first click.
- **Dropdowns unchanged:** the status and assignee dropdowns still write the fields directly through `PATCH`. The new buttons are the safe path, but the dropdowns can still overwrite a claim as before. I documented this rather than changing it.

\### Follow-ups noticed
- **`PATCH` can still overwrite a claim held elsewhere:** that route could warn, or refuse unless forced, when it sets the active status or the assignee on an issue that is claimed elsewhere. This would be a rule change, so it may be best done after #105.

**Orchestrator notes:** merged on top of #105 with no conflicts; web, service and CLI claim suites pass (632 tests). Browser check on a scratch repo: "Claim" on an unassigned issue assigned it to the acting user and switched to "Release" (`issue: claim #1` commit); "Claim" on Bob's issue showed "Issue #3 is already claimed by Bob (in_progress)." inline with "Take over", which reassigned it. The PATCH follow-up is filed as a separate issue.
