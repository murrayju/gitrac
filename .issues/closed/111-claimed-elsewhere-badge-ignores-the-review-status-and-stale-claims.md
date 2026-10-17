---
id: 111
title: Claimed-elsewhere badge ignores the review status and stale claims
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-16T21:58:38.249Z'
createdBy: Justin Murray
updated: '2026-10-17T14:02:08.049Z'
---

Follow-ups from #105 and #106:

- `ClaimedElsewhereBadge` always uses the active status's colors. A claim that is in the review status elsewhere looks the same as active work. `ClaimedElsewhere` doesn't carry the status today.
- The web UI has no stale-claim indicator, and there is no way to renew a claim or release a stale one from the web (the new claim/unclaim routes from #103 could take `renew` / `stale`).

## Acceptance criteria

- `claimedElsewhere` includes the status (additive field), and the badge uses that status's style and label.
- `POST /api/issues/:id/claim` accepts `renew`, `/unclaim` accepts `stale`; the UI marks stale claims (with a configured or entered threshold) and offers "Release stale claim".
- Consider an optional `staleAfter` default in `config.yaml` so `--stale` need not be passed on every call.
- Tests.

---

### Justin Murray — 2026-10-17T14:02:07.608Z

Typecheck and lint come back clean (0 warnings), the Vite build passes, and `./bun test src/cli src/web src/core src/service` passes (1316 tests).

\## What was wrong
- `ClaimedElsewhere` had no status field. So `ClaimedElsewhereBadge` always used the active status's colors, and a claim in the review status in another worktree looked like active work.
- The web UI never showed stale claims. The claim/unclaim routes didn't take `renew` or `stale`, so you couldn't renew a claim or release a stale one from the browser.

\## What changed
- **Status on claims:** `ClaimedElsewhere` now includes `status` (set in `toClaimedElsewhere`). It's an extra field, so JSON output gains `status` and nothing else changes.
- **`staleAfter` config key:** new optional key in `config.yaml`, read with `parseDuration`. A bad value is `invalid_config`. It is unset by default and `createDefaultConfig` is unchanged.
  - Only the web UI uses it. The CLI still needs `--stale <duration>` on every call, and the spec and skill now say so.
- **Server, `src/web/routes/issues.ts`:**
  - When `staleAfter` is set, every issue response gets `staleClaim` for stale issues, in the same shape as `ls --stale`. This covers the list, single-issue and mutation responses and a 409's `current`, and is computed from the cached scan.
  - Issues that exist only elsewhere are checked too.
  - `?stale=` still filters the list, as before.
- **Claim routes:**
  - `POST /claim` accepts `renew: true`.
  - `POST /unclaim` accepts `stale: "<duration>"`. A bad duration is 400.
  - Both map to the existing service options. A claim that isn't stale still gets 409 `already_claimed`, with its age in the message.
- **UI:**
  - **Badge colors:** `ClaimedElsewhereBadge` uses the claim's own status style. A review claim reads `Review by Bob in wt-1` (full text: `Claimed by Bob (Review) …`). If the status is missing or not held in this config, it falls back to the active status.
  - **Stale badge:** new `StaleClaimBadge` ("stale: no activity for 3h"). It shows in the list row next to the title and in the detail sidebar.
  - **Buttons in `ClaimControls`:** "Renew" appears on your own active claim. "Release stale claim" replaces "Release" when someone else's claim is stale; it sends `stale: config.staleAfter` without `force`. If the server refuses, the existing "Release anyway" retry still works.
  - The decision and wording logic is in `lib/claim.ts` and `lib/claimed-elsewhere.ts` (`claimStatus`, `staleClaimText`, `staleClaimTitle`).
- **Docs:** the design spec (config, stale claims, API table, list and detail views) and `skills/using-gitrac/SKILL.md` are updated.

\## Tests
- **Core:** `status` is in `claimedElsewhere`, including a review claim. Config tests check that `staleAfter` validates, round-trips, and stays out of the default config. Existing whole-object comparisons were updated for the new field.
- **Routes (`issues-claim.test.ts`):**
  - renew works as a heartbeat but doesn't take over someone else's claim;
  - bad `renew`/`stale` values return 400 and write nothing;
  - stale unclaim releases an old claim but gets 409 on a fresh one;
  - `staleClaim` appears only when `staleAfter` is set, including on claims elsewhere and in a 409's `current`;
  - a review claim elsewhere carries its status and is never marked stale.
- **UI helpers:** tests cover the new buttons (renew, release stale, review claim elsewhere) and the claim status and stale wording.

\## Decisions and trade-offs
- "Release stale claim" only appears when `staleAfter` is set. Without it there's no threshold to send, so the plain "Release" stays.
- Your own stale claim shows "Renew" and "Release", not "Release stale claim".
- If `staleAfter` holds a bad value in memory (it can't come from a validated file), the server skips the stale marks instead of failing.
- `IssueRow.tsx` got only the badge render. I didn't touch `MetadataPanel.tsx`; the stale badge sits inside `ClaimControls`.
- The task asked for a "configured or entered threshold". Only the configured one is supported; there's no field to type one in.

\## Follow-ups noticed
- In the web route test, renew is checked by the issue's new `updated` and a clean tree, not the commit message. Web commits within the amend window merge into the earlier commit, so the message reads `claim #1 First (+ edits)` instead of `renew …`.
- A field for entering a stale threshold (for when `staleAfter` isn't set) could be added later.

**Orchestrator notes:** merged after #109, #110, #112 and #113; conflicts were in the `ApiIssue` doc comment, test imports and appended tests, and the spec's `GET /api/issues` row and List/Detail View paragraphs (both sides' text kept). Browser check on a scratch repo with `staleAfter: 1h`: an agent worktree's claim idle for 9h showed "claimed by Agent One in gitrac-demo-wt1" and "stale: no activity for 9h" in the list; the detail view offered "Release stale claim", which released it without force (`issue: unclaim #2`, back to `todo`).
