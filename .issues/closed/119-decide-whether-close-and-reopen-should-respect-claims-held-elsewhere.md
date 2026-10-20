---
id: 119
title: Decide whether close and reopen should respect claims held elsewhere
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-17T14:25:26.507Z'
createdBy: Justin Murray
updated: '2026-10-20T22:22:44.698Z'
---

Found by #108. `edit` / `PATCH` now refuse a status or assignee change when someone else holds the issue (here or in another worktree or branch), unless forced. `close` and `reopen` (`closeIssue` / `reopenIssue`) don't check claims. That is often right (an orchestrator closes an agent's finished work), but a close on main can silently supersede a newer active claim in an agent's worktree, and the agent's later merge then fights with it.

## Acceptance criteria

- Decide the rule (for example: `close` of an issue held by someone else elsewhere needs `--force`, or only warns on stderr), document it in the spec and skill, and apply it identically on the CLI and the web.
- Tests with a real worktree claim.

---

### Justin Murray — 2026-10-20T21:14:05.038Z

Renumbered from #115 (duplicate ID).

### Justin Murray — 2026-10-20T22:22:44.240Z

`close` and `reopen` now follow the same claim rule as `edit` (#108), on both the CLI and the web. Typecheck and lint are clean, and the full test run of `src/service`, `src/cli`, `src/web` and `src/core` passes (1382 tests, 0 failures). Of the 11 new tests, 10 fail without the change.

\## What was wrong
`closeIssue` / `reopenIssue` did not check claims. A close on `main` could quietly supersede a newer claim in an agent's worktree, and the agent's later merge would then fight with it. `edit` / `PATCH` already refused this since #108; close and reopen did not.

\## What changed
- **Rule:** `close` and `reopen` are refused with `already_claimed` (exit 3 / HTTP 409) when the issue's newest version anywhere (here, other worktrees, branches) is held (active or review) by someone other than the acting user. `force` overrides. The message and the `assignee` / `claimedElsewhere` details match `claim` and `edit`. Closing or reopening your own claim, or an unassigned or unheld issue, works as before.
- **Service** (`src/service/issues.ts`):
  - Both functions take `force?: boolean`, next to `cancelled` / `status` / `comment`, so `closeIssue`'s options stay simple for #117.
  - A small helper, `assertClaimFree`, scans the other worktrees and branches under the lock and reuses `decideEdit` through the existing `assertCanEdit`. No new rule function was added.
  - It also sets `updated` past every version found elsewhere, so a forced close supersedes the claim.
  - It runs after the existing status and already-closed/already-open checks, so those errors come first.
- **CLI:** `close -f/--force` and `reopen -f/--force` (no conflicting `-f` existed). On a refusal the CLI adds a hint: `Use --force to close it anyway.` / `Use --force to reopen it anyway.`
- **Web:** `PATCH /api/issues/:id/close` and `/reopen` accept `author` (the "Acting as" user) and `force` in the body. A `force` that is not a boolean gets a 400.
- **Web UI:** nothing to change. It never calls these routes; it closes and reopens through the status dropdown (`PATCH /api/issues/:id`), which already offers "Change anyway".
- **Docs:** updated the spec, the skill, `README.md` and `AGENTS.md`.
  - The skill now says an orchestrator closing a stuck agent's issue uses `--force`, and an agent closing its own claim needs nothing.
  - The skill and README also note that an orchestrator closing a review handoff under a different identity needs `--force`.

\## Tests
- **Service** (`src/service/edit-claim.test.ts`): refused locally and in a real worktree (message says where), force and its supersede timestamp, the holder closing and reopening, an unheld issue, and a reopen refused when the issue was claimed again elsewhere.
- **CLI** (`src/cli/commands/worktree-claims.test.ts`, real worktrees): exit 3 with the hint and the JSON `claimedElsewhere`, the holder closing from another worktree, `close -f` superseding the claim, and `reopen` with and without `--force`.
- **Web** (`src/web/routes/issues-claim.test.ts`): 409 locally and with a worktree claim, `force`, `author` as the holder, and 400 for a bad `author` or `force`.
- No existing test closed someone else's claim, so none needed `force` added.

\## Decisions / trade-offs
- I chose to refuse rather than only warn, because a warning on stderr is easy for agents to miss.
- A reopen can only be refused through a newer version elsewhere, since a closed local issue is never held.
- `close` and `reopen` now always scan the other worktrees and branches. This adds a little cost to every close and reopen, which is acceptable because they are status changes.

\## Follow-ups noticed
- #117 (`gitrac commit`) calls `closeIssue`; it passes `--force` through (an agent closing its own claim needs nothing).
- `api.ts` still has unused `closeIssue` / `reopenIssue` helpers. They could be removed, or given `force` / `author` if a UI path ever uses them.

**Orchestrator note:** merged after #120 with no conflicts; core, service, web route and CLI claim/close suites pass (884 tests).
