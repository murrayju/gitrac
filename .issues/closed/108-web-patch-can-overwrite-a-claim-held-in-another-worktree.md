---
id: 108
title: Web PATCH can overwrite a claim held in another worktree
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T21:58:35.182Z'
createdBy: Justin Murray
updated: '2026-10-17T14:25:05.135Z'
---

Found by #103. The web UI's status and assignee dropdowns write through `PATCH /api/issues/:id` (`updateIssue`), which skips the claim rules (`decideClaim`). Setting the active status or an assignee there can silently overwrite a claim that an agent holds in another worktree or on another branch. The new Claim / Release buttons (#103) are the safe path, but the dropdowns still allow it.

## Acceptance criteria

- A PATCH that sets a held status or the assignee on an issue that is claimed by someone else (here or elsewhere) is refused with 409 `already_claimed` (with `claimedElsewhere`), unless the request says to force it. Decide whether `gitrac edit` follows the same rule (CLI and web should match).
- The UI shows the refusal inline, with a way to take over.
- Tests.

---

### Justin Murray — 2026-10-17T14:25:04.758Z

I've implemented #108. A status or assignee change through `PATCH /api/issues/:id` or `gitrac edit` is now refused when someone else holds the issue, here or in another worktree or branch, unless it is forced. Typecheck, lint (0 warnings, 0 errors), the full test run (1335 pass, 0 fail) and the vite build all pass. With the old `src/service/issues.ts` put back, 8 of the new service and route tests fail, so they do test the change.

\## What was wrong
The web UI's status and assignee dropdowns save through `PATCH /api/issues/:id` (`updateIssue`), and `gitrac edit` uses the same function. It never checked claims. So changing the status or assignee could silently overwrite a claim held by someone else, locally or in another worktree or branch. Only the Claim / Release buttons checked claims.

\## What changed
- **The rule** (`src/core/claim.ts`, new `decideEdit`): an edit that really changes `status` or `assignee` is refused when the issue's newest version anywhere (here, other worktrees, branches) is held (active or review status) and assigned to someone other than the acting user, unless `force`. The holder can always edit. Title, priority, labels and description edits are always allowed.
- **Service** (`updateIssue` in `src/service/issues.ts`):
  - New `force` option.
  - The no-op check runs first, so a no-op is still a no-op.
  - The other worktrees and branches are scanned under the lock only when status or assignee actually changes, so other edits stay cheap.
  - The error is `already_claimed` with the same message and details (`assignee`, `claimedElsewhere`) as `claimIssue`.
  - After a scan, `updated` is set past every version found elsewhere, so a forced edit replaces the claim, like `claim --force`.
- **CLI** (`edit.ts`): new `-f, --force`, and the help text mentions exit 3. The hint added to the error is: `Use --force to change it anyway, or "gitrac claim <id> --force" to take it over.`
- **Web route**: the PATCH body accepts optional `author` and `force`, which are taken out before field validation. The acting user comes from `webServiceContext(ctx, { author })`. A bad author or a non-boolean `force` is 400. `errorResponse` already returned the claim route's 409 body, so only its doc comment changed.
- **UI**:
  - `MetadataPanel.tsx` and `IssueRow.tsx` now send the "Acting as" author with their PATCHes.
  - On a 409 `already_claimed`, the existing inline error line shows the server's message plus a **Change anyway** button that sends the same change again with `force: true`.
  - The logic is a small helper, `saveField`, in a new file `src/web/ui/lib/claim-edit.ts`. It reuses `claimConflict` and goes through the existing save queue.

- **Docs**: the spec has a new section "Editing a claimed issue", plus updates to the `edit` row, the PATCH row, the exit-code table, the timestamp paragraph and the List/Detail view text. `SKILL.md` gets an edit row, a short paragraph, the exit-code table entry and a common-mistakes row. `README.md` gets an edit row.

\## Tests
- **Core** (`claim.test.ts`): refused, force, holder, other fields only, not held or no assignee, newer and older claims elsewhere, review status.
- **Service** (new `service/edit-claim.test.ts`, with a real worktree):
  - refused locally and elsewhere, with details;
  - force replaces the claim even when the other worktree's clock is ahead;
  - the holder may edit; a no-op stays a no-op;
  - other-field edits don't scan: `updated` is not pushed past the claim elsewhere, and the claim is still in effect.
- **CLI** (`worktree-claims.test.ts`):
  - `edit -s` and `edit -a` exit 3 with the hint, and the JSON error has `claimedElsewhere`;
  - the holder can edit from another worktree;
  - `-p` and `-t` work;
  - `--force` works and clears the claim marker.
- **Route** (`issues-claim.test.ts`): PATCH 409 locally and elsewhere, force, `author` decides who the acting user is, `force`/`author` are not written into the issue, bad author or force is 400.
- **UI helper** (`claim-edit.test.ts`): the retry is offered only for `already_claimed`; it sends `force`; a new save removes the button.

\## Decisions and trade-offs
- **`gitrac edit` follows the same rule as the web**, so both surfaces behave the same.
- **Only the stored issue is checked.** An edit that sets an unassigned issue to the active status with some assignee is allowed. After that, it counts as a claim for everyone else.
- **The identity is always looked up** in `updateIssue`, before the issue is loaded. That way a bad web `author` is 400 even for a priority-only edit. On the CLI this costs two `git config` calls per edit.
- **Priority saves also send `author` and go through `saveField`.** The server ignores it for priority, but any new save then clears an old "Change anyway" button.
- **Label saves and the title editor are unchanged.** They never touch claim fields.

\## Follow-ups noticed
- **`close` / `reopen`**: these don't check claims, so anyone can close someone else's active claim. That is probably fine (the orchestrator closes agents' work), but a close can quietly replace a newer claim in another worktree. That is worth a separate decision.
- **Label saves** send no `author`. That's harmless today, but it would matter if label edits were ever attributed to someone.
- **Assignee column in the list view**: it is read-only. If it ever becomes editable, it should use `saveField` too.

**Orchestrator notes:** merged last, after #109 to #113. `issues-claim.test.ts` was rebuilt from `main`'s version plus this change's `send(..., method)` helper and appended `describe` block (git had interleaved the two appended blocks), and two expectations gained the `status` field that #111 added to `claimedElsewhere`. The spec's Claiming and List/Detail View text keeps both sides. Full suite after the merge: 1609 tests, 0 failures. Browser check on a scratch repo: with Bob holding #1, changing its status in the sidebar showed "Failed to save status: Issue #1 is already claimed by Bob (in_progress)." with "Change anyway"; the file was unchanged until "Change anyway" sent it with `force` (`issue: edit #1`). The `close` / `reopen` question is filed as a follow-up.
