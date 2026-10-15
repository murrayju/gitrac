---
id: 55
title: Issue dependencies and a ready/next command
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T03:24:20.516Z'
---

To orchestrate agents, the tracker must describe the work graph.

## Acceptance criteria

- Frontmatter fields `blockedBy: number[]` (and derived "blocks"), optional `parent: number`.
- `gitrac link <id> --blocked-by <id>` / `unlink`.
- `gitrac ready` lists open, unassigned (or mine), unblocked issues sorted by priority then ID; `-o json`.
- `gitrac next --claim` atomically picks and claims the top ready issue (under the mutation lock).
- Web UI shows dependencies on the detail view.

---

### Justin Murray — 2026-10-15T03:24:20.516Z

\## #55: issue dependencies, `ready` and `next --claim`

**What was wrong:** gitrac couldn't describe the work graph. Issues had no dependency fields, and nothing could list unblocked work or let an agent pick and claim the next issue in one atomic step.

**What changed:** all five acceptance criteria are covered. `./bun run check` passes (895 tests). I also tried the CLI by hand in a scratch repo, including three `next --claim` runs in parallel (each got a different issue), and looked at the detail view in a browser.

\### Data model
- **New fields:** `parent?: number` and `blockedBy?: number[]` on `Issue` / `IssueFrontmatter` (`src/core/types.ts`).
- **Parsing** (`src/core/issue.ts`): values are coerced the way `labels` already is. A single value becomes a list, numeric strings are accepted, anything that isn't an ID is dropped, and the list is sorted and de-duplicated.
- **Writing:** the fields are only written when set or non-empty, placed after `labels`. Existing files round-trip byte-for-byte; the `.issues/` round-trip test still passes.
- **"blocks" and sub-issues are derived, not stored**, so a link only ever edits one file.

\### Rules (pure code in `src/core/`)
- **`dependencies.ts`** – derives "blocks" and sub-issues, checks input shape, and `validateLinks` rejects:
  - an issue blocking itself or being its own parent;
  - targets that don't exist;
  - `blockedBy` cycles, direct or indirect (the error shows the chain);
  - parent cycles.
- **`ready.ts`** – `isAvailableTo(issue, user)` is the single "can I take this?" check (open, and unassigned or mine), as asked for #56 to extend. `readyIssues` reuses the `ls` filters and sorting from `src/core/query.ts`. `nextIssue` picks the top ready issue.

\### Service layer
- **`src/service/links.ts`** – `linkIssue` / `unlinkIssue`, run under the repo lock and checked against all issues, open and closed. Asking for links that are already there (or already absent) writes and commits nothing. Commit messages are `issue: link #N <title>` / `unlink #N <title>`.
- **`src/service/ready.ts`** – `listReadyIssues`, `findNextIssue`, and `claimNextIssue`, which picks and then calls the existing `claimIssue` while holding the lock once. `loadAllIssues` was added to `list.ts`.
- **Errors:** new code `no_ready_issues`, exit 5 (the same exit code as `not_found`).

\### CLI
- `link <id> -b/--blocked-by <ids> [--parent <id>]` and `unlink <id> [-b <ids>] [--parent]` (`src/cli/commands/link.ts`).
- `ready` and `next [--claim] [-c]` (`src/cli/commands/ready.ts`) take `--status`, `--priority`, `--label`, `--mine`, `--search` and `--sort` (default: priority, then ID). They don't take `--assignee`: anything assigned to someone else is never ready, so it could only return nothing.
- `show` (human output) now lists Parent, Sub-issues, Blocked by and Blocks with titles and statuses. `show -o json` is unchanged apart from the new fields when they're set.

\### Merge driver
`src/git/conflict.ts` merges `blockedBy` as a set, the same way as `labels` (the helper is now generic), and `parent` like any other single field.

\### Web
- `GET /api/issues/:id` includes `parent` and `blockedBy` when set.
- New endpoints:
  - `GET /api/issues/:id/dependencies` returns `{ parent, children, blockedBy, blocks, blocked }`.
  - `POST /api/issues/:id/link` and `/unlink` go through `mutateIssue`, so they honour `If-Match` and return 400 `{ error, errors }` for invalid links.
- **Detail view:** a read-only `DependenciesPanel` in the sidebar. Linked issues are clickable with a status badge; closed or missing ones are struck through. It refreshes on live updates through `useIssueDependencies`, using the shared event connection.

\### Decisions you may want to revisit
- **Cancelled and deleted blockers unblock.** A cancelled blocker will never be done, so keeping it blocking would leave its dependents stuck for good. This is documented.
- **`parent` doesn't affect readiness**; it is informational only.
- **`next` skips issues already `in_progress`, including mine.** `ready` still lists them. Otherwise several agents using the same git identity would all "resume" the same issue.
- **Backlog issues count as ready** because they are open. Use `--status todo` to narrow it.
- **A missing link target is `invalid_input` (exit 2 / HTTP 400), not `not_found`.** That keeps 404 meaning "the issue you're editing doesn't exist".

\### Files
- **New:** `src/core/{dependencies,ready}.ts`, `src/service/{links,ready}.ts`, `src/cli/commands/{link,ready}.ts`, `src/web/ui/components/DependenciesPanel.tsx`, and tests in `src/core/{dependencies,ready}.test.ts`, `src/service/{links,ready}.test.ts`, `src/cli/commands/ready.test.ts`, `src/web/routes/issues-dependencies.test.ts`.
- **Modified:** `src/core/{types,issue,errors}.ts`, `src/git/conflict.ts`, `src/service/{context,list}.ts`, `src/cli/{index,output}.ts`, `src/cli/commands/show.ts`, `src/web/routes/issues.ts`, `src/web/ui/{api,hooks}.ts`, `src/web/ui/components/IssueDetail.tsx`, plus tests in `src/core/issue.test.ts` and `src/git/conflict.test.ts`.
- **Docs:** `AGENTS.md`, `skills/using-gitrac/SKILL.md`, `docs/specs/2026-03-28-gitrac-design.md` (new Dependencies section, commands, exit codes, merge rules, API routes, detail view).

\### Overlap with #64
My edits to shared files are small: two values (`'link'`, `'unlink'`) added to `Operation` in `src/service/context.ts`, and the three new routes appended to `src/web/routes/issues.ts`. The link service uses `assetPaths(ctx, …)`, so it will follow whatever #64 decides about committing assets.

\### Follow-ups noticed
- **#56:** extend `isAvailableTo` in `src/core/ready.ts`. Both `ready` and `next --claim` already go through it.
- **Deleting an issue leaves dangling references** in other issues' `blockedBy` / `parent`. They are harmless (treated as resolved and shown as "missing"), and `unlink` can remove them, but `deleteIssue` could strip them automatically.
- **Two branches can each add a link that together form a cycle**; the merge driver can't see this because the links live in different files. The issues involved simply never become ready (documented).
- **Possible extras:** link editing in the web UI, a `GET /api/ready` endpoint, and a "blocked" marker in `ls`.

**Orchestrator note:** adapted `src/service/links.ts` to the `assetPaths(issue)` signature introduced by #64 when merging.
