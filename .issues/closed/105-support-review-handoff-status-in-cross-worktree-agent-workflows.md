---
id: 105
title: Support review / handoff status in cross-worktree agent workflows
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
blockedBy:
  - 93
  - 94
created: '2026-10-16T12:13:31.379Z'
createdBy: Justin Murray
updated: '2026-10-16T20:56:22.436Z'
---

In an orchestrator-subagent workflow (such as `.opencode/commands/work-backlog.md`), a subagent claims an issue (`in_progress`), implements the fix on its worktree branch, and hands it off for review before the orchestrator verifies, merges, and closes it (`done`).

Currently, cross-worktree claim protection (`decideClaim` in `src/core/claim.ts` and `claimedElsewhere` in `src/core/elsewhere.ts`) is hard-coupled to a single `activeStatus` (default `in_progress`). If a project configures a `review` status and a subagent moves an issue from `in_progress` to `review`, `gitrac` stops treating the issue as claimed on that branch/worktree — the elsewhere badge disappears and another agent can claim it.

## Acceptance criteria

- Allow cross-worktree claim visibility and protection to cover in-review / multi-stage active work (e.g. an optional `reviewStatus` workflow hook in `config.yaml`, or treating any open status after `todo` / any configured active status with an assignee as held).
- Provide a clean way in the CLI/API to transition an issue to review (or preserve cross-worktree claim protection when an assigned issue moves to a review status) until it is closed or unclaimed.
- Update workflow docs, spec, and skill; add tests.

---

### Justin Murray — 2026-10-16T20:56:22.047Z

I've implemented the review handoff from #105, following the orchestrator's design. Typecheck and lint are clean (0 warnings, 0 errors), and all tests pass across `src/core`, `src/service`, `src/cli`, `src/web` and `src/git`.

\## Summary: review / handoff status in cross-worktree agent workflows

\### What was wrong
gitrac only treated an issue as claimed when it was in the single `activeStatus` (default `in_progress`); `decideClaim`, `decideUnclaim`, `claimedElsewhere` and `nextIssue` all compared against it. So when an agent moved its issue to a `review` status in its worktree, every other worktree stopped seeing it as claimed: the elsewhere badge went away, `next` offered it again, and anyone could `claim` it without `--force`.

\### What changed
- **Config:** new optional `reviewStatus` key (`src/core/config.ts`, `src/core/types.ts`). It must be a configured open status, different from the active and unclaim statuses. If those two keys are unset, it is compared against their fallback values. `createDefaultConfig` is unchanged, so with the key unset nothing behaves differently.
- **One notion of "held"** (`src/core/workflow.ts`): `reviewStatus(config)`, `heldStatuses(config)` (the active status, plus the review status if set) and `isHeldStatus(config, s)`. An assigned issue in a held status counts as claimed.
- **Claim rules** now use "held" instead of "active":
  - `decideClaim`: someone else's issue in review needs `--force`. Running `claim` on your own issue in review moves it back to `in_progress` (rework).
  - `decideUnclaim`: an issue in review goes back to `unclaimStatus`.
  - `claimedElsewhere` reports issues in review, with the same shape as before.
  - `nextIssue` skips them.
- **New rule `decideReview`** (`src/core/claim.ts`) and **service op `submitForReview`** (`src/service/claim.ts`). It runs under `withRepoLock` and scans other worktrees and branches under the lock, like `claimIssue`. It sets the review status, keeps the assignee, sets `updated` with `nextTimestamp` (later than the local and every other version), and commits `issue: review #N <title>`.
- **New CLI command `gitrac review <id> [-c comment] [-f]`** (`src/cli/commands/review.ts`):

| Situation | Result |
|---|---|
| No `reviewStatus` configured | Exit 2 (`invalid_input`), naming the key; checked before the issue is loaded |
| Issue not claimed | Exit 3 (`invalid_state`), with the hint `Use "gitrac claim N" first.` |
| Someone else's claim | Exit 3 (`already_claimed`), unless `--force` |
| Closed here or elsewhere | Exit 4 (`issue_closed`) |
| Already in review | No-op (exit 0, no commit) |

- **Error message:** the `already_claimed` message from `claim` now shows the status the issue is actually in, e.g. `(review)`, instead of always the active status.
- **Docs:** the design spec (config example, fallbacks, validation, command table, Claiming table, a new "Review handoff" section, exit codes), `README.md` (commands, config comment, parallel-agents bullet, exit codes), the `using-gitrac` skill, the `AGENTS.md` command list and service list, and the `unclaim` help text.

\### Tests
Each new test fails without the change: they use new exports or depend on review being treated as held.
- **`src/core/config.test.ts`:** the review status is not configured, is closed, equals the active status (explicit or fallback), or equals the unclaim status (explicit or fallback); a valid config parses.
- **`src/core/workflow.test.ts`:** `reviewStatus`, `heldStatuses`, `isHeldStatus`.
- **`src/core/claim.test.ts`:** claim and unclaim with the review status, and every outcome of `decideReview` (including closed elsewhere and handing off a claim held elsewhere).
- **`src/core/elsewhere.test.ts`, `src/core/ready.test.ts`:** an issue in review is claimed elsewhere and skipped by `next`; without the config key it isn't.
- **`src/service/claim.test.ts`:** `submitForReview` end to end, including the claim rework and the unclaim back to `todo`.
- **`src/cli/commands/worktree-claims.test.ts`:** with real worktrees, an agent claims and runs `review` in its worktree. On main the issue still shows as claimed elsewhere, `claim` exits 3, `ready` and `next` skip it, and `unclaim --force` releases it. Also covered: rework via `claim`, and the two error cases.

\### Decisions and trade-offs
- **Review needs an active claim, and is a no-op if already in review.** An unclaimed issue is refused with `invalid_state` instead of being moved to review, so that a review always has an assignee and stays held.
- **`review --force` keeps the other person's assignee.** The point is to hand off their work, not take it over.
- **Your own issue that is in the active status here but in review in a newer version elsewhere is not a no-op for `claim`:** it is claimed back to the active status. This seemed like the right reading of "rework".
- **No web route was added.** The service op is ready for one; the issue for web claim actions can add it.

\### Follow-ups noticed
- `ClaimedElsewhereBadge` (web UI) always uses the active status's badge colour, even for a claim that is in review. It could use the status of the version found elsewhere, but `ClaimedElsewhere` doesn't include the status today.
- The `ready`/`next` CLI help still says "in_progress" when describing what `next` skips. It is accurate when no review status is set.
