---
id: 41
title: Issue fields are never validated on write
status: done
priority: high
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T23:11:41.358Z'
---

`validateIssue()` exists but is never called. Both the CLI and web API accept arbitrary values:

- `gitrac edit 2 -s bogus` writes `status: bogus`
- invalid priorities, empty titles, non-array labels (API) are accepted
- the API trusts the request body types entirely

## Acceptance criteria

- All create/update paths (CLI + web) validate status, priority, title, labels and types before writing; invalid input yields a clear error (CLI exit code 1, HTTP 400) and no file change.
- Unknown labels: CLI behaves like the web (auto-register with a color in config) or warns — pick one consistently and document it.
- Tests for the rejection paths.

---

### Justin Murray — 2026-10-14T23:11:41.358Z

Issue #41: create and edit (CLI and web) now validate every field before writing anything to disk. Bad input fails with a clear error and leaves all files unchanged. `./bun run check` passes (454 tests), and the new rejection tests are in place. I didn't actually run them against the old code to watch them fail. They should, because the old code accepted all of these inputs (e.g. `edit -s bogus` exited 0).

**What was wrong**
`validateIssue()` existed but nothing called it. `gitrac edit 2 -s bogus` wrote `status: bogus`. The CLI also accepted bad priorities and blank titles (`-t "   "`), and turned `-l ""` into a label `[""]`. The web API took the request body as-is, so it would write a string as `labels`, a number as `title` or `author`, or any status. Malformed JSON caused a 500. Web create also bumped `nextId` before it checked anything.

**What changed**
- **New check, `validateIssueFields(input, config, { requireTitle })`** in `src/core/validate.ts`. It accepts untrusted input and checks each field:
  - `status` and `priority` must be in the lists in `config.yaml`, so a customised config is respected.
  - `title` must be non-empty; `labels` must be an array of non-empty strings; `assignee` and `description` must be strings.
  - It trims titles, assignees and labels, removes duplicate labels, and returns every error at once.
- **`parseLabelList`** handles the CLI's `-l` value: it drops empty entries, so `-l "bug, ui,"` gives `[bug, ui]` and `-l ""` clears labels.
- **CLI `create` / `edit`** run the check inside the repo lock, before allocating an ID or writing. On failure they print one `Error: …` line per problem and exit 1. One bad field rejects the whole edit.
- **Web `POST` / `PATCH /api/issues`** run the same check and return 400 with `{ error, errors[] }`. Create checks before allocating an ID. Malformed or non-object JSON now gets a 400 instead of a 500.
- **Comment routes** now reject a malformed body and a non-string `author` with 400.
- **Final check on create:** both CLI and web run `validateIssue` on the assembled new issue. This catches a config whose default status or priority isn't in its own lists.
- **Unknown labels:** I chose to make the CLI do what the web already did. Unknown labels are added to `config.labels` with a color, in the same commit as the issue. The new `registerLabels(dir, labels)` in `src/fs/issue-store.ts` does this for both; the web's `syncLabelColors` now uses it.

**Files**
- Code: `src/core/validate.ts`, `src/fs/issue-store.ts`, `src/cli/commands/create.ts`, `src/cli/commands/edit.ts`, `src/web/routes/issues.ts`, and the new `src/cli/validation.ts` (`exitWithErrors`).
- Tests: `src/core/validate.test.ts`, plus new `src/web/routes/issues-validation.test.ts` and `src/cli/validation.test.ts`. The CLI and web tests take a snapshot of `.issues/` (and `HEAD` for the CLI) and check that it is unchanged after a rejection.
- Docs: `docs/specs/2026-03-28-gitrac-design.md` (new "Write validation" paragraph), `skills/using-gitrac/SKILL.md`, and `AGENTS.md` (a convention line).

**Decisions and trade-offs**
- On edit and `PATCH`, only the fields being changed are checked, not the whole stored issue. Otherwise an existing file with an old status, or with the Date-typed `created`/`updated` values from #44, would block unrelated edits.
- I put `exitWithErrors` in its own file rather than in `global-options.ts` to avoid merge conflicts with #42.
- The web checks against `ctx.config`, the same config it uses for defaults.
- Assignees are now trimmed.

**Follow-ups noticed (not fixed)**
- `claim`, `close` and `reopen` (CLI and web) write fixed statuses (`in_progress`, `done`, the default status) without checking them against `config.statuses`. They will write a status the config doesn't allow if a project removes one. `claim.ts` belongs to #42.
- Once #44 makes `created`/`updated` reliably strings, edit could also run the full `validateIssue` as a final check.
- `ctx.config` in the web server can go stale if `config.yaml` is edited while the server runs. This existed before my change; validation now inherits it.
