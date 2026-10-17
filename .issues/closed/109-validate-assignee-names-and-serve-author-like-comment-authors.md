---
id: 109
title: Validate assignee names and serve --author like comment authors
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T21:58:36.141Z'
createdBy: Justin Murray
updated: '2026-10-17T13:45:54.766Z'
---

Found by #98. Author names are now checked (`authorError`: no line breaks, no em dash), but two inputs that become authors are not:

- `PATCH /api/config/assignees` (`updateAssignees`) accepts names and emails with line breaks or an em dash. The web "Acting as" picker can then send such a name, and the write fails later with a 400.
- `gitrac serve --author <name>` is not checked at startup; a bad value fails on every write.

## Acceptance criteria

- `updateAssignees` rejects bad names/emails with `invalid_input` (HTTP 400), using the same helper.
- `serve --author` with a bad name fails at startup with exit 2.
- Tests.

---

### Justin Murray — 2026-10-17T13:45:54.338Z

I've finished the fix for #109. Typecheck and lint are clean, all tests in `src/` pass, and the seven new tests fail when the source changes are removed.

\## What was wrong
- **Assignee list:** `PATCH /api/config/assignees` (`updateAssignees`) only checked that `name` and `email` were non-empty strings. A name or email with a line break or an em dash (U+2014) was saved. The web "Acting as" picker could then pick that name, and every later write failed with a 400.
- **`serve --author`:** `gitrac serve --author <name>` (and bare `gitrac --author <name>`) did not check the name at startup. A bad name started the server, then failed on every write.
- **Claim path:** you asked me to confirm `claimIssue` can't add a bad entry to `config.assignees`. It can. The claim check only rejects line breaks, so a git identity like `Ada — L <ada@x.com>` was added to the list.

\## What changed
- **New shared check (`src/core/validate.ts`):**
  - `authorError` now takes an optional label so messages can say `assignee name` or `assignee email`. The default is still `author`, so existing messages are the same.
  - New `assigneeErrors(entry)` returns every problem with one entry. Both name and email must pass `authorError`: no line break, no em dash.
- **`updateAssignees` (`src/service/config.ts`):** checks every entry before writing and throws one `invalid_input` listing all the bad ones. Nothing is written or committed.
- **Config route (`src/web/routes/config.ts`):** the 400 response now also includes an `errors` array when there are several problems, as the issue routes already do. With one problem the body is `{ error }`, as before.
- **`runServe` (`src/cli/commands/serve.ts`):** checks `--author` with `authorError` before resolving the project root or binding the port. A bad name exits with code 2. Other commands are not checked globally, as you asked.
- **`claimIssue` (`src/service/claim.ts`):** the claim itself still succeeds, but the user is only added to `config.assignees` if they pass `assigneeErrors`. This means a name with an em dash can still claim without a comment, as before #98.
- **Docs:** the spec (author rules and the API table row) and `skills/using-gitrac/SKILL.md` are updated.

\## Tests
- `src/core/validate.test.ts`: `assigneeErrors` accepts a valid entry, rejects malformed ones, and reports a bad name and a bad email together.
- `src/service/config.test.ts`: bad names and emails are all listed, and the config file and commits are unchanged.
- `src/service/claim.test.ts`: a claim by `Ada — L <ada@example.com>` succeeds but does not add her to `config.assignees`.
- `src/web/routes/config.test.ts` (new): a good request returns 200; a request with several bad entries returns 400 with `errors[]` and leaves the file unchanged; one bad entry returns 400 with `{ error }` only.
- `src/cli/commands/serve.test.ts` (end to end): `--author 'A — B' serve`, bare `--author 'A — B'`, and `--author $'A\nB' serve` each exit 2 with the expected message.

\## Decisions and trade-offs
- **Emails use the full author rule,** so an em dash in an email is rejected too, as your design notes asked.
- **The claim skips the bad entry instead of failing,** because the claim itself is valid.
- **The `--author` check runs before the project-root check,** like the port check, so input errors are reported first.
- **The "not a name/email pair" message changed.** It used to be `Each assignee must have non-empty "name" and "email" strings` and now names the bad entry. Nothing else in the repo matched the old text.

\## Follow-ups noticed
- An existing `config.yaml` that already has a bad entry is not cleaned up. It is still loaded, and the picker can still pick it (the write then fails with a 400, as before).

**Orchestrator note:** the `AssigneePicker` follow-up (a failed save is ignored and the email is still set as the assignee) is fixed separately as part of this batch.
