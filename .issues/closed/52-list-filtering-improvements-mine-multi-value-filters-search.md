---
id: 52
title: 'List filtering improvements: --mine, multi-value filters, search'
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T01:50:30.280Z'
---

- `ls --assignee` requires an exact match on the stored value (usually an email); allow matching by name or email (case-insensitive).
- Add `--mine` (current git identity).
- Support comma-separated values for `--status`, `--priority`, `--label` as shown in the spec (`--priority urgent,high`).
- Add `--search <text>` over title/description.
- Show labels in the human list output.
- Keep CLI and web API filter semantics identical (ideally shared code).

---

### Justin Murray — 2026-10-15T01:50:30.280Z

\## #52: List filtering: `--mine`, multi-value filters, search, labels column

\### What was wrong
- `gitrac ls` and `GET /api/issues` each had their own copy of the filter and sort code, and the two had drifted apart:
  - **Closed statuses:** for something like `--status done`, the CLI read both directories but the web read only `closed/`.
  - **Sort fields:** the CLI supported `status` but not `created`; the web was the reverse.
  - **Default order:** the CLI sorted by ID; the web returned files in whatever order they came, unsorted.
  - **Unreadable files:** the CLI crashed on one; the web skipped it.
- `--assignee` only matched the exact stored value, which is usually an email.
- Comma-separated values (`--priority urgent,high`, as shown in the spec) didn't work.
- There was no `--mine` or `--search`, and the human list output didn't show labels.

\### What changed
- **One shared implementation.** New `src/core/query.ts` holds the filter, search and sort logic as pure functions (no I/O). `parseIssueQuery` parses and checks raw input against the config. New `src/service/list.ts` (`listIssues`) loads `.issues/`, and reads `.issues/closed/` only when a closed status or `all` is asked for. The CLI `ls` command and the web route both call it, so they return the same issues in the same order.
- **Semantics:**
  - `status`, `priority`, `label` and `assignee` take comma-separated values and can be repeated. An issue matches a filter if it matches any of its values, and must match every filter given.
  - Without a status filter you get open issues only. `all` lists everything.
  - **Assignee matching** ignores case and accepts the stored value, a name or an email. A name or email listed in `config.assignees` also matches its counterpart, so `--assignee "Justin Murray"` finds `justin@…`.
  - **`--mine`** matches the current user's name or email: git identity or `--author` in the CLI, the server's identity for `?mine=1` on the web.
  - **`--search`** matches when every word appears (ignoring case) in the title or description. The web also accepts `q` as an alias for `search`.
  - **Sort fields:** `id` (default), `priority`, `status`, `created`, `updated`. Ties are broken by ID.
  - **Bad input:** unknown statuses, priorities or sort fields are rejected with exit 2 / HTTP 400. Labels and assignees aren't checked; no match just gives an empty list.
- **Human output:** added a Labels column (last, so the others stay aligned). The Assignee column now widens to fit the longest value; emails used to overflow it and push the following columns out of line.
- **Web UI:** `IssueFilters` / `fetchIssues` in `src/web/ui/api.ts` gained optional `search` and `mine`. The existing UI filters work unchanged; I didn't add any new UI controls.

\### Files
- **New:**
  - `src/core/query.ts`, `src/core/query.test.ts`
  - `src/service/list.ts`
  - `src/cli/commands/list.test.ts`
- **Modified:**
  - `src/cli/commands/list.ts`, `src/cli/output.ts`, `src/cli/output.test.ts`
  - `src/web/routes/issues.ts`, `src/web/routes/issues.test.ts`
  - `src/web/ui/api.ts`
  - `docs/specs/2026-03-28-gitrac-design.md`: List Filters section, command table, API route table
  - `skills/using-gitrac/SKILL.md`

\### Tests
- `src/core/query.test.ts`: unit tests for the shared logic.
- `src/cli/commands/list.test.ts`: runs the real CLI. It includes a check that runs about ten queries through both `gitrac ls -o json` and `GET /api/issues` and compares the results.
- New tests in `src/web/routes/issues.test.ts` cover multi-value filters, assignee/`mine`, search and the 400 errors; `src/cli/output.test.ts` covers the labels column and alignment.
- `./bun run check` passes (737 tests).

\### Decisions / trade-offs
- **Filtering is by the `status` field, not the folder.** The default list now leaves out a `done`/`cancelled` issue even if its file is still in `.issues/`; the old CLI showed it.
- **Status and priority are checked against the config.** Before, `--status typo` silently returned nothing; now it's an error.
- **Unreadable files** are skipped by both surfaces. The CLI prints a warning to stderr for each one; it no longer crashes.
- **Web default order changed.** With no `sort` given, the web now sorts by ID. The UI re-sorts on the client anyway, so nothing visible changes.
- **Web `mine` uses the server's identity,** not the UI's "Acting as" choice, which only exists in the browser.

\### Follow-ups / interactions
- **#63:** if duplicate files for the same ID exist (open and closed), `listIssues` can return both. Removing duplicates belongs with #63's `findIssueFile` and write-path work.
- The status sort order and the closed-status set are still hard-coded, as before (`Status` is a fixed type). The web UI's status/priority dropdowns are also hard-coded. If the config ever leaves out one of those values, choosing it in the UI now gets a 400 instead of an empty list.
