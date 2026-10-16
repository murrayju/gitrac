---
id: 94
title: >-
  Superseding a cross-worktree or branch state can fail on same-millisecond
  timestamps or clock skew
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
blockedBy:
  - 93
created: '2026-10-16T12:12:40.589Z'
createdBy: Justin Murray
updated: '2026-10-16T20:15:47.129Z'
---

`unclaimIssue` and `claimIssue --force` (`src/service/claim.ts`) release or override a claim held in another worktree or branch by writing a local version whose `updated` timestamp supersedes `elsewhere.updated`.

However, `newestElsewhere` (`src/core/elsewhere.ts`) compares timestamps with strict `isLater` (`>`), while `claimIssue` / `unclaimIssue` set `issue.updated = new Date().toISOString()` without ensuring the new timestamp is strictly greater than the previous local `updated` and any `elsewhere` `updated` timestamp.

If a script or agent claims and releases within the same millisecond, or if a remote branch's claim came from a machine whose clock was slightly ahead, `unclaim` prints `Released the claim … (this newer version supersedes it)`, but `newestElsewhere` still considers the other branch's timestamp newer (or tied), so the claim immediately reappears as active.

## Acceptance criteria

- Ensure mutations that write `issue.updated` (especially `claimIssue`, `unclaimIssue`, `closeIssue`, `reopenIssue`, `updateIssue`) produce an ISO timestamp strictly greater than the issue's existing `updated` and (where scanned) any `elsewhere` state's `updated` (e.g. `new Date(Math.max(Date.now(), maxPriorMs + 1)).toISOString()`).
- Unit and service tests covering same-millisecond and slightly future-dated `elsewhere` timestamps.

---

### Justin Murray — 2026-10-16T20:15:46.718Z

\## Summary

\### The bug
When the service layer rewrote an existing issue, it set `issue.updated = new Date().toISOString()`. But `newestElsewhere` (`src/core/elsewhere.ts`) only counts a version as newer if its `updated` is strictly greater (`>`). Two cases broke:

- **Same millisecond:** if a claim and its release happened within one millisecond, both versions had the same timestamp.
- **Clock skew:** if a claim on another branch or worktree came from a machine whose clock was ahead, the claim looked newer than the local release.

In both cases `unclaim` and `claim --force` said the new version supersedes the old claim, but the old claim stayed in effect straight away. Ordinary edits had the same problem: a quick second write could get the same timestamp as the first.

\### What changed
- **New pure helper `nextTimestamp(after, now = Date.now())`** in `src/core/timestamp.ts`. It returns whichever is later: `now`, or the latest parseable timestamp in `after` plus 1 ms. Missing or unparseable values are ignored.
- **Every write to an existing issue now uses it**, passing the issue's current `updated`:
  - `src/service/issues.ts`: `updateIssue`, `addComment`, `editComment`, `deleteComment`, `closeIssue`, `reopenIssue`
  - `src/service/links.ts`: `writeLinks` (link and unlink)
  - `src/service/delete.ts`: the relinked issues
  - `src/service/renumber.ts`: the renumbered issue and the `--update-refs` relinks
- **`claimIssue` and `unclaimIssue`** (`src/service/claim.ts`) also pass every `updated` from the other-branch and other-worktree versions they already scan.
- **Comment timestamps still equal the new `updated`** (claim, close, reopen, edit and `addComment` comments, and the renumber comment).
- **Edits stay on the timestamp lines only**, so they should merge easily with #98's author validation in the same functions.
- **Docs:** the claims section of `docs/specs/2026-03-28-gitrac-design.md` and the unclaim paragraph of `skills/using-gitrac/SKILL.md` now describe this guarantee.

\### Tests
- `src/core/timestamp.test.ts`: a later `now`, the same millisecond, a future-dated input, sub-millisecond input, unparseable or missing values, and the default clock.
- `src/service/claim.test.ts`: uses a real git worktree holding a claim whose `updated` is either the same as the frozen "now" or 5 minutes ahead of it. Checks that `unclaim` and `claim --force` each produce `updated` 1 ms after that claim, and that afterwards `claimedElsewhere` (from a fresh `issueStatesElsewhere` scan) is `undefined`. It also checks the claim comment's timestamp.
- `src/service/issues.test.ts`: with the clock frozen, nine writes in a row (edit, comment, comment edit and delete, link, unlink, close, reopen) give timestamps that each go up by exactly 1 ms. A future-dated `updated` on the issue is still superseded, and the comment timestamps match `updated`.
- All 7 new service tests fail without the fix.
- Typecheck and lint are clean (0 warnings, 0 errors). `src/core`, `src/service`, `src/git`, `src/web` (including `src/web/routes`), `src/cli` and `src/fs` all pass: 1508 tests.

\### Decisions and trade-offs
- **Freezing the clock in tests:** the tests use bun's `setSystemTime` rather than adding a clock to `ServiceContext`, which keeps the production change small.
- **`createIssue` is unchanged:** a new issue has no earlier version to beat.
- **Relinks share one clock reading:** in `delete` and `renumber`, `Date.now()` is read once and each linked issue is bumped only past its own `updated`.
- **Small cost in the clock-skew case:** a local write can be stamped slightly in the future, up to the other machine's clock offset. That is needed so the newest version wins.

\### Follow-ups noticed
- Writes other than claim and unclaim (close, edit, comment and so on) only go past the local `updated`, not past versions elsewhere, because they don't scan other branches. A future-dated claim elsewhere can therefore still outrank a local close or edit. Fixing that would need a scan in those operations too.
- The merge driver's "`updated` is the later of the two" rule is unchanged. It could keep a skewed future timestamp after a merge, which may be worth a look.

**Orchestrator notes:** merged on top of #97/#98 (conflicts were imports and appended test blocks; `writeLinks` keeps #97's directory repair). Also fixed a flaky #98 test in `src/service/issues.test.ts` ("an identity named ... cannot write a comment"): it started four mutations at once and awaited them one by one, so Bun could report a rejection as unhandled and a leftover write ran after the fixture was removed. Each attempt now starts only when it is awaited. The first follow-up above (writes other than claim/unclaim only beat the local `updated`) is left as is: those writes don't scan other branches, and a claim elsewhere still decides availability.
