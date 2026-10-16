---
id: 106
title: Add claim lease / stale-claim detection for crashed or timed-out subagents
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
blockedBy:
  - 93
  - 94
created: '2026-10-16T12:13:32.495Z'
createdBy: Justin Murray
updated: '2026-10-16T21:58:08.661Z'
---

When orchestrating parallel subagents across worktrees, a subagent process can crash, hang, or hit a context/timeout limit after claiming an issue. Because claims have no TTL or staleness check, the issue stays `in_progress` indefinitely unless the orchestrator externally tracks agent health and runs `gitrac unclaim <id> --force`.

## Acceptance criteria

- Support detecting and reclaiming stale claims based on claim age / lease duration (e.g. `--stale <duration>` on `ls`, `ready`, `next --claim`, and `unclaim`, and/or an optional `--lease <duration>` when claiming).
- Allow an orchestrator or `next --claim` (when configured/flagged) to identify or take over claims that have exceeded the staleness threshold without activity.
- Document in `skills/using-gitrac/SKILL.md` and the design spec; add unit and CLI tests.

---

### Justin Murray — 2026-10-16T21:58:08.238Z

Stale-claim detection and recovery for #106 is in place, across the CLI, the service layer and `GET /api/issues`. Typecheck and lint are clean (0 warnings, 0 errors), and `./bun test src/core src/service src/cli src/web --only-failures` passes 1273 tests with 0 failures. With my source changes stashed, the new core and service tests fail.

\## What was wrong
A claim had no lease. If an agent crashed, hung or hit a context or time limit after claiming, the issue stayed `in_progress` forever. The only way out was for the orchestrator to track agent health itself and run `unclaim --force`.

\## What changed
- **Rules (`src/core/stale.ts`, new):**
  - `parseDuration` accepts `30s`, `45m`, `2h` or `1d` and rejects anything else with `invalid_input` (exit 2).
  - `staleClaim(issue, config, states, { maxAgeMs, now })` returns `{ assignee, updated, ref?, worktree? }` when the issue's newest version anywhere is in the active status, assigned, and older than `maxAgeMs`.
  - A claim in review, or one whose `updated` can't be parsed, is never stale.
  - `now` is passed in, so tests need no frozen clock.
- **Ready/next rules (`src/core/ready.ts`):** `readyIssues` and `nextIssue` take an optional set of stale IDs. Those issues count as available, `next` no longer skips them, and blockers still apply.
- **Service layer:**
  - `listIssues` with `stale` keeps only stale claims and returns `staleClaims`. It reuses a scan it is given (the server's cache) or runs one fresh.
  - `listReadyIssues`, `findNextIssue` and `claimNextIssue` accept `stale`. `next --claim` passes `stale` to `claimIssue`, which checks staleness again on its fresh scan under the repo lock. A claim renewed in the meantime gets `already_claimed` instead of being taken.
  - `unclaimIssue` with `stale` releases someone else's claim without force only if it is stale. Otherwise it fails with `already_claimed` and the message says why, e.g. "Its last activity was 25m ago, less than 2h." or "A claim in review is never stale."
  - `claimIssue` with `renew` on your own active claim writes a newer `updated` and commits `issue: renew #N <title>` instead of doing nothing. On anything else `--renew` is a normal claim.
- **CLI:**
  - `--stale <duration>` on `ls`, `ready`, `next` and `unclaim`, and `--renew` on `claim`.
  - Human output adds `[stale claim by X, last activity <iso>]` to list rows and a `Stale:` line to `next`'s detail output; json/yaml add `staleClaim`.
  - stderr notes when a stale claim is taken over, released or renewed.
- **Web:** `GET /api/issues?stale=2h` behaves like `ls --stale`, uses the cached scan, and returns 400 for a bad duration.
- **Docs:** a new "Stale claims" section in the design spec (plus the command table, claim table, commit messages and API row), dead-agent recovery and heartbeats in `SKILL.md`, the README (stuck or dead agents, CLI reference), and the `AGENTS.md` command list.

\## Tests
- **`src/core/stale.test.ts`:** the duration parser, accepted and rejected values; duration formatting; the stale check for local versus elsewhere, fresh, review, unassigned, unparseable `updated` and a custom active status.
- **`src/core/ready.test.ts`:** stale IDs are ready and picked, and stay blocked by an open blocker.
- **`src/service/stale.test.ts`:** list, ready and next with `stale`; `next --claim` takeover; claim and unclaim refuse fresh claims with the age message; review claims are never stale; renew bumps `updated` and commits.
- **`worktree-claims.test.ts`, real worktrees:**
  - An agent's idle uncommitted claim is listed by `ls --stale`, offered by `ready`/`next --stale`, and taken over by `next --claim --stale` from main.
  - A fresh claim is never taken.
  - `unclaim --stale` releases only the stale claim.
  - A review claim is never stale.
  - `--no-commit claim --renew` in the worktree makes the claim fresh again.
  - Bad durations exit 2.
- **`issues-elsewhere.test.ts`:** `?stale=` filtering, the `staleClaim` field, one cached scan, and 400 for a bad value.

\## Decisions and trade-offs
- **`claim --stale` exists in the service only.** `claimIssue` takes a `stale` option so `next --claim` can re-check under the lock. I did not add `claim <id> --stale` to the CLI because the design didn't ask for it; it is a one-line follow-up.
- **`next --stale` can return your own stale claim.** Without `--stale`, `next` skips your own held work. With it, a stale claim of yours is offered, and taking it renews it. That fits recovering your own dead agent under a shared identity.
- **Closed local issues are never treated as stale.** Taking one over would reopen it.
- **Stale claims count only if `ready` would list them.** Blocked or filtered-out stale claims are dropped from `ready`'s `staleClaims`.
- **Test setup ages every copy first.** In the CLI tests, the issues' `updated` is set back 10 hours in every worktree before claiming, so an idle claim is still the newest version. Otherwise main's unclaimed copy would win.

\## Follow-ups noticed
- The web UI does not show a stale badge, and there are no web endpoints for renew or unclaim-if-stale yet; that depends on the claim/unclaim web API work in #103.
- `show` doesn't mark stale claims; it would need a flag, since there is no default threshold.
- A per-project default lease in `config.yaml` (e.g. `staleAfter: 2h`) would save orchestrators passing `--stale` on every call.

**Orchestrator notes:** merged on top of #103 (the only conflict was `ClaimOptions` in `src/service/claim.ts`: #103's `precondition` and this change's `stale` / `renew` are both kept). Full suite after the merge: 1542 tests, 0 failures. The web follow-up (stale badge, renew and unclaim-if-stale through the new claim routes) is filed as a separate issue.
