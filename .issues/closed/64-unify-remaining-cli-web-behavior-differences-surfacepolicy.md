---
id: 64
title: Unify remaining CLI/web behavior differences (SurfacePolicy)
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - chore
created: '2026-10-15T01:16:55.011Z'
createdBy: Justin Murray
updated: '2026-10-15T03:17:38.596Z'
---

Follow-ups from the #51 service-layer refactor, which deliberately preserved existing CLI/web differences via `SurfacePolicy` (`CLI_POLICY` / `WEB_POLICY` in `src/service/`). Decide on one behavior for each and remove the switch:

- Asset files are only committed by web operations (CLI-created comments referencing assets don't commit them); `deleteComment` never commits assets.
- Field edits are committed as `edit #N` (CLI) vs `update #N` (web); web comment messages include the issue title, CLI's don't.
- CLI `edit` always includes `config.yaml` in the commit even when unchanged.
- CLI `-c` comments aren't trimmed; web comments are.
- Bad reopen status: CLI reports the status error first, web reports issue errors (404/409) first.
- Web never pushes (ignores `autoPush`).
- `PATCH /api/config/*` with a non-JSON / `null` body returns 500 instead of 400.
- `edit` on a file without frontmatter prints `# #NaN: …` — malformed issue files should produce a clear `invalid_issue` error.
- Claim/unclaim error messages mention CLI flags (`--force`, `gitrac reopen`); make messages surface-neutral (or let adapters supply hints) before adding a web claim route.

---

### Justin Murray — 2026-10-15T03:17:38.596Z

\## #64: Remove the CLI/web `SurfacePolicy` differences

**What was wrong:** after #51, `SurfacePolicy` (`CLI_POLICY` / `WEB_POLICY`) kept several CLI/web differences on purpose: which files got committed, commit-message wording, whether comments were trimmed, which error was reported first on reopen, and whether the web pushed. There were also four separate bugs:
- `PATCH /api/config/*` returned 500 when the body was bad.
- Editing an issue file with no frontmatter rewrote it as `NaN-<slug>.md` and committed that. I reproduced this in a scratch repo.
- `ls` listed that file as `#NaN`.
- Claim/unclaim error messages named CLI flags.

**What changed:** `SurfacePolicy`, `CLI_POLICY` and `WEB_POLICY` are gone. Each switch now has one behavior on both surfaces:

| Switch | Chosen behavior |
|---|---|
| Assets | Every operation commits the `.issues/assets/` files the issue references. Comment delete commits the ones the issue still references and never removes any. `assetPaths` now only accepts plain filenames (`isAssetFilename`), so a reference like `/.issues/assets/../x` can't add a file outside the assets folder to a commit. |
| Commit messages | The CLI wording, always with the title: `edit #N <title>` and `comment on #N <title>`. |
| `config.yaml` | Committed only when it actually changed (new labels registered). |
| Comments | Trimmed everywhere, including `-c` on edit/close/reopen/claim/unclaim. A blank `-c` adds no comment. |
| Error order | Input is validated before the issue is loaded, in `updateIssue`, `addComment`, `editComment` and `reopenIssue`. A bad request now gets 400 even if the issue is missing or the `If-Match` version is stale. |
| Web push | The web follows `config.git.autoPush`. A pushed commit can't be amended (the amend tracker already refuses), so with autoPush each web edit becomes its own pushed commit and pushed history is never rewritten. A failed web push is logged to stderr and the request still succeeds, because the change is already written and committed. This uses a new `ServiceContext.onPushError` option. The CLI still exits 7 on a failed push. |

The other bullets:
- **Config body:** `PATCH /api/config/labels` and `/api/config/assignees` now return 400 for non-JSON, `null` or array bodies. The JSON-reading helpers moved into a new shared file, `src/web/request-body.ts`.
- **Malformed issue files:** there's a new error code, `invalid_issue` (exit 1, like `invalid_config`). It comes from a new `parseIssueFile`, which rejects files with no frontmatter, bad YAML, or an `id` that doesn't match the file name. The message names the file, e.g. `Issue file .issues/2-bad.md is malformed: no YAML frontmatter. Fix or remove it.`
  - It is used by `loadStoredIssue` (all mutations), `readIssue` (`show`) and web `GET` / mutations, which answer 409 `{ error, code: "invalid_issue", file }`.
  - `listIssues` skips these files with the existing "skipping unreadable issue file" warning.
  - Nothing is written.
- **Claim/unclaim messages:** the service messages no longer mention CLI flags (e.g. `Issue #1 is already claimed by X (in_progress).`). The CLI adds its hints by error code with a new `withHint` in `src/cli/errors.ts`, so CLI output is unchanged.

**Files:**
- **Service:** `src/service/{context,issues,claim,load,list}.ts`
- **Core / fs:** `src/core/{errors,issue}.ts`, `src/fs/issue-store.ts`
- **CLI:** `src/cli/{errors,service-context}.ts`, `src/cli/commands/{claim,unclaim}.ts`
- **Web:** `src/web/{service-context,request-body}.ts`, `src/web/routes/{issues,config}.ts`
- **Docs:** `AGENTS.md`, `docs/specs/2026-03-28-gitrac-design.md` (commit messages, committed files, push, exit-code table, API table), `skills/using-gitrac/SKILL.md` (exit-code table)

**Tests:** `./bun run check` passes (860 tests).
- New file `src/web/surface-parity.test.ts` covers the config 400s, the `edit #N` message, autoPush (pushed, not amended, push failure doesn't fail the request), web `invalid_issue`, and reopen error order.
- New tests in `core/issue.test.ts` (`parseIssueFile`), `cli/errors.test.ts` (`withHint`) and `cli/structured-errors.test.ts` (no `#NaN` from `edit`, `show`, `comment` or `ls`).
- Updated service tests that asserted the old split behavior, plus the claim message tests.

**Trade-offs:**
- With autoPush on, web autosaves each make their own commit and push. That's the cost of never rewriting pushed history.
- An `If-Match` mismatch combined with invalid input now returns 400, not 409.
- The `edit` commit message wording is a visible change for web users (it used to be `update #N`).

**Follow-ups noticed:**
- The amend tracker treats a branch with a remote but no upstream as never amendable, and autoPush on such a branch logs a push failure on every web edit. Both predate this change.
- The web UI doesn't show `invalid_issue` specially; it's a generic 409 error.
- For #55: new service operations shouldn't reintroduce per-surface switches. CLI hints belong in the adapter via `withHint`, and input should be validated before the issue is loaded. My edits to `list.ts` and `web/routes/issues.ts` are small, but #55 likely touches both files.
