---
id: 57
title: Statuses and priorities are not actually customizable
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T04:39:25.205Z'
---

The spec says statuses/labels/priorities in `config.yaml` are the source of truth and user-customizable, but `Status`/`Priority` are hard-coded unions, `validateConfig` rejects anything outside the built-in sets, closed statuses are hard-coded to `done`/`cancelled`, and sort orders are hard-coded.

Either make them genuinely configurable (status definitions with a `closed: boolean` flag and order; priority order from config) or update the spec/docs to say they're fixed.

---

### Justin Murray — 2026-10-15T04:39:25.205Z

\## #57: Statuses and priorities are now configurable

**What was wrong**
The spec said statuses and priorities in `config.yaml` were the source of truth, but the code didn't treat them that way:
- `Status` and `Priority` were hard-coded unions, and `validateConfig` rejected any name outside the built-in sets.
- `isClosedStatus` was hard-wired to `done`/`cancelled`.
- `claim` always set `in_progress`, `unclaim` always went back to `todo`, and `close` always used `done`/`cancelled`.
- The `ls`/`ready` sort orders and every web UI dropdown, filter and badge had their own fixed lists.

**What changed**
- **Config model** (`src/core/types.ts`):
  - `Status` and `Priority` are now plain strings.
  - `config.statuses` holds definitions `{ name, label?, color?, closed }`, in workflow order.
  - `config.priorities` holds definitions `{ name, label?, color? }`, most urgent first.
  - Four new optional keys: `activeStatus`, `unclaimStatus`, `closeStatus`, `cancelStatus`.
- **New `src/core/workflow.ts`** holds the built-in names as constants (`DEFAULT_STATUSES`, `DEFAULT_PRIORITIES`, `DEFAULT_ACTIVE_STATUS`, …) and all the status logic: `isClosedStatus(config, s)`, the resolvers for the four keys, `statusSortOrder`, and labels.
  - If one of the four keys is unset, the built-in name is used when it's configured with the right open/closed kind. Otherwise:
    - active → the last open status
    - unclaim → `defaultStatus`
    - close → the first closed status
    - cancel → none
  - This keeps older configs that listed only some of the built-in statuses valid.
- **Reading and validating** (`src/core/config.ts`):
  - Each entry can be a plain name or a definition. On read, plain names become definitions: `done`/`cancelled` are closed, any other name is open.
  - New `configErrors()` returns readable messages. It checks:
    - names are unique and valid (lowercase, `_`, `-`; `all` is reserved)
    - definitions have no unknown keys, colors are hex, `closed` is true/false
    - at least one status is open and one is closed
    - `defaultStatus` is configured and open; `defaultPriority` is configured
    - `activeStatus`/`unclaimStatus` are open and differ; `closeStatus`/`cancelStatus` are closed
  - An invalid config is reported as `invalid_config` (exit 1), listing every problem.
- **Writing** (`serializeConfig`): any entry that needs only its name is written as a plain name. So the plain-list format, including this repo's `.issues/config.yaml`, round-trips byte-for-byte (the existing test still passes), and older gitrac versions can still read it. The definition form is only written for entries that need it, and only when the file is being written anyway (new label, assignee, merge). Reading never rewrites the file.
- **Code that used fixed names now reads the config:** query filtering and sorting (`--sort status` keeps the old in_progress, todo, backlog, done, cancelled order), lifecycle, claim/unclaim, "claimed elsewhere", `ready`/`next`, dependencies, validation, and the matching services.
- **close:**
  - Uses `closeStatus` by default.
  - `--cancelled` uses `cancelStatus`; if none is configured it fails clearly with exit 2 and the list of closed statuses.
  - New `-s/--status <closed status>` option.
  - The web route `PATCH /api/issues/:id/close` takes `{ status }` or `{ cancelled: true }`.
- **Web UI:**
  - New `useWorkflow()` hook and `lib/workflow.ts`.
  - `StatusBadge` and `PriorityBadge` use the configured label and color, falling back to the built-in colors, then gray.
  - Dropdowns in `MetadataPanel`, `IssueRow` and `CreateIssueModal` come from the config.
  - `IssueList` filters and column sorts use the configured orders.
  - The UI builds with `./bun run vite build --config vite.config.ts`.
- **Docs:**
  - New "Statuses and Priorities" section in the spec, plus updates to the claim, close, sort and API sections.
  - New SKILL.md note.
  - New AGENTS.md rule: don't hard-code status or priority names.

**Files:** `src/core/{types,workflow,config,lifecycle,query,claim,elsewhere,ready,dependencies,validate}.ts`, `src/service/{issues,claim,ready,list}.ts`, `src/cli/commands/{close,list,show,claim,unclaim,ready}.ts`, `src/web/routes/issues.ts`, `src/web/ui/{hooks.ts,lib/workflow.ts,components/*}`, docs.

**Tests:** new `src/core/workflow.test.ts`, `src/service/workflow.test.ts` and `src/web/ui/lib/workflow.test.ts`, plus new cases in the config, lifecycle, query, claim, close CLI, web close route and config merge tests. Existing tests were updated for the new function signatures. `./bun run check` passes: 994 tests.

**Decisions and trade-offs**
- **Status sort order** isn't a separate setting. It's derived from the list: open statuses furthest along first, then closed ones in list order. This keeps the old order with no extra key.
- **Old config that's now invalid:** a config whose `defaultStatus` is a closed status used to load; it is now rejected, as the issue asked.
- **Statuses missing from the config:** a status an issue has but the config doesn't list is judged by the old rule (`done`/`cancelled` closed, anything else open).
- **Function signatures:** the core functions now take `config` as a required argument, so a caller can't silently fall back to the built-in names.
- **Merge driver:** it compares the parsed definitions, so the plain and definition forms of the same status merge cleanly. If a merge would produce an inconsistent config, it falls back to a plain text merge.
- **New-issue priority in the UI:** it still starts at `none`, but uses `defaultPriority` when `none` isn't configured.

**Follow-ups noticed (not fixed)**
- `createIssue` with a closed status, e.g. `create -s done`, still writes the file into `.issues/` rather than `closed/`. This was already the case before.
- The web API's `closeIssue`/`reopenIssue` client helpers don't send `status` or `cancelled` yet, and the UI has no "close as…" control.

**Orchestrator browser verification:** with a custom workflow (triage / ready "Ready to go" #22aa88 / in_progress / review "In Review" #aa66ff / done / wontfix closed) the list filters, badges, and the detail-view status dropdown all reflect config labels/order; choosing "Wontfix" in the UI moved the issue to `.issues/closed/` with `status: wontfix`. CLI `close --cancelled` without a cancel status fails clearly (exit 2).
