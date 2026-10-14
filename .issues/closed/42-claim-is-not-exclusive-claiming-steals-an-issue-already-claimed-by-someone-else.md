---
id: 42
title: >-
  Claim is not exclusive — claiming steals an issue already claimed by someone
  else
status: done
priority: high
assignee: justin@tigerdata.com
labels:
  - bug
  - feature
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T23:09:11.643Z'
---

`gitrac claim` unconditionally overwrites `assignee`. If alice claims #2 and then bob claims #2, bob silently wins. The skill claims "Other agents will see the issue is taken", which is false.

This is the main blocker for using gitrac to coordinate multiple agents.

## Acceptance criteria

- `claim` fails (non-zero exit, clear message) if the issue is already `in_progress` and assigned to someone else.
- `--force` overrides.
- Claiming an issue you already own is idempotent (no-op, no new commit).
- Claiming a closed issue requires `--force` (or explicit reopen) instead of silently reopening.
- Claim check + write happens under the mutation lock (depends on the concurrency fix).
- Add an `unclaim` (or `release`) command to give an issue back.

---

### Justin Murray — 2026-10-14T23:09:11.643Z

\## #42: `claim` is now exclusive, and a new `unclaim` / `release` command gives issues back

**What was wrong**
`gitrac claim` always overwrote `assignee`. If Bob claimed an issue Alice was already working on, he silently took it. Claiming a closed issue also reopened it without asking. There was no command to give an issue back, and the skill's line "Other agents will see the issue is taken" was false.

**What changed**
- **New file `src/core/claim.ts`** holds the pure decision logic (no file or git access):
  - `decideClaim`, `decideUnclaim` and `isAssignedTo`.
  - Your identity is your git email, or your name if there's no email or `--author` is given. An assignee counts as "you" if it matches either value, ignoring case.
  - Exit code constants: `EXIT_ALREADY_CLAIMED = 3` and `EXIT_ISSUE_CLOSED = 4`.
- **`src/cli/commands/claim.ts`** re-reads the issue and runs the check inside `withMutationLock`, so when several people claim at once exactly one wins.
  - **In progress and someone else's:** fails with exit 3, writes nothing, makes no commit.
  - **Closed** (`done`/`cancelled`, or the file is in `closed/`): fails with exit 4. The message points to `reopen` or `--force`.
  - **Already yours and in progress:** does nothing (exit 0, no write, no commit). It prints the issue plus a note on stderr. A `-c` comment is **not** added, and the note says so.
  - **`-f, --force`** takes over someone else's issue, or reopens and claims a closed one.
  - `config.assignees` is only updated when the claim actually goes ahead.
  - I added two helpers here, `parseIssueIdArg` and `resolveClaimUser`, which `unclaim` reuses.
- **New file `src/cli/commands/unclaim.ts`** adds `unclaim <id>` (alias `release`), registered in `src/cli/index.ts`.
  - It clears `assignee` and moves `in_progress` back to `todo`; any other status is left alone.
  - Releasing someone else's issue fails with exit 3 unless you pass `--force`.
  - Closed issues fail with exit 4. An unassigned issue does nothing.
  - It accepts `-c`, runs under the lock, and commits as `<prefix> unclaim #N <title>`.
- **Tests:**
  - `src/core/claim.test.ts` unit-tests the decision table.
  - `src/cli/commands/claim.test.ts` runs the real CLI as separate processes. It covers: refusing a steal (no commit made), `--force` takeover, re-claiming your own issue (no commit, file unchanged), claiming by git email, closed issues needing `--force` (leaves a clean tree), 6 claims at once with exactly one winner, and unclaim/release in all its cases.
  - Several of these would fail without the fix, including the refused steal, the no-op re-claim and the closed-issue check.
- **Docs:** `AGENTS.md`, `skills/using-gitrac/SKILL.md` (claim workflow, exit codes, unclaim) and `docs/specs/2026-03-28-gitrac-design.md` (command table, a new "Claiming" section with the decision table, the exit codes, and `unclaim` added to the `--no-commit` list).

`./bun run check` passes: 408 tests, 0 failures.

**Decisions and trade-offs**
- I followed the acceptance criteria literally: a claim is only refused when the issue is `in_progress` and assigned to someone else. An issue pre-assigned to Bob but still `todo`/`backlog` can still be claimed by Alice.
- A closed issue gets its own exit code (4), separate from "already claimed" (3). Exit 1 is still the general error. #46 can fold these into a formal scheme.
- `unclaim` moves the issue to `todo` rather than `backlog`, since the old status isn't recorded. It never works on closed issues, even with `--force`.
- `--author` gives a name with no email, as before. So `--author Alice` and Alice's git email (alice@…) count as different people unless the assignee string matches one of them.

**Follow-ups and interactions**
- #41 (validation): `claim`/`unclaim` write `assignee`/`status` directly and don't go through the new validators. If #41 adds validation inside `writeIssue`, these commands get it automatically.
- #44 (normalising fields in `parseIssue`): `isAssignedTo` already copes with empty or whitespace-only assignees. If `parseIssue` starts normalising `assignee`, nothing here needs to change.
- The web UI has no claim action, so it bypasses these checks: it can still set `assignee`/status freely through edit.
- If the on-disk filename doesn't match the title, `unclaim` renames it the way `edit` does. `claim` has always just written the new filename for open issues, which can leave the old file behind. That's an existing issue I didn't touch.
