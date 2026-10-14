---
id: 44
title: Unquoted YAML dates are parsed as Date objects and crash the CLI
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T23:06:59.992Z'
---

gray-matter's YAML engine converts unquoted ISO timestamps (`created: 2026-03-28T12:00:00Z` — exactly as shown in AGENTS.md and the design spec) into `Date` objects. `gitrac ls` then crashes in `shortDate` calling `.slice` on a Date, and JSON output shape changes.

Also note gray-matter caches parse results keyed by input string, so returned objects (e.g. `labels` arrays) may be shared between calls.

## Acceptance criteria

- `parseIssue` normalizes `created`/`updated` to ISO strings regardless of quoting (or uses a YAML schema without timestamp resolution).
- Normalize other fields defensively (`id` number, `labels` array of strings, `assignee` string).
- Avoid gray-matter cache aliasing (copy arrays or disable cache).
- Tests for unquoted dates.

---

### Justin Murray — 2026-10-14T23:06:59.992Z

Fixed #44: unquoted YAML dates in issue frontmatter no longer crash `gitrac ls`, and every frontmatter field now comes out of `parseIssue` with the right type. `./bun run check` passes (394 tests, typecheck and lint), and the 11 new tests fail without the fix.

\## What was wrong
gray-matter's default YAML schema turns unquoted timestamps like `created: 2026-03-28T12:00:00Z` (the format shown in AGENTS.md and the spec) into `Date` objects. `parseIssue` passed them through unchanged, so `gitrac ls` crashed in `shortDate` when it called `.slice` on a Date, and the JSON/YAML output shape changed. No other field was coerced either: `id`, `labels`, `assignee` and the rest kept whatever type YAML gave them. gray-matter also caches parse results by input string with no limit, so parsing the same content twice handed back the same `data` object and `labels` array.

\## What changed
- **`src/core/issue.ts`**
  - `parseIssue` now calls gray-matter with a YAML engine that uses js-yaml's `CORE_SCHEMA`, which has no timestamp type.
    - Unquoted and quoted dates both come back as strings, exactly as written.
    - Date-like titles (e.g. `title: 2026-03-28`) are no longer altered.
    - This schema can't run `!!js/*` code.
  - Passing an options object also turns off gray-matter's cache, which fixes the shared-object problem and the unlimited cache growth in the long-running server.
  - Each field is now coerced defensively:
    - `id`: number; numeric strings are accepted, anything else becomes `NaN`.
    - `title`, `status`, `priority`, `assignee`, `createdBy`, `created`, `updated`: string, with missing/null becoming `''`. Any `Date` that still gets through becomes `toISOString()`.
    - `labels`: always a new array of strings. A single value becomes a one-item list, and empty entries are dropped.
- **`src/js-yaml.d.ts`**: added `CORE_SCHEMA` and the `load(input, { schema })` option to the local type declarations. This only adds to the file.
- **Tests**:
  - `src/core/issue.test.ts`: unquoted dates (full and date-only), date-like titles, round-trip, JSON shape, type coercion, missing fields, bad `id`, and the shared-object case.
  - `src/cli/output.test.ts`: list output for an issue with unquoted dates, both human and JSON.
- **`docs/specs/2026-03-28-gitrac-design.md`**: one bullet under "Parsing Rules" describing the schema and the coercion.

I also checked the CLI end to end in a scratch repo: `ls`, `show` and `-o json ls` all work on a file with unquoted dates.

\## Decisions / trade-offs
- I chose to turn off timestamp parsing rather than convert `Date` objects back to strings. Converting would rewrite values (`…T12:00:00Z` → `…T12:00:00.000Z`) and change date-like titles. Values are kept as written instead, and when gitrac saves the file they are re-quoted (`'…'`), so the round-trip is stable.
- `CORE_SCHEMA` also drops YAML extras (`<<` merge keys, `!!binary`, `!!set`), none of which issue frontmatter uses.
- `status` and `priority` are only turned into strings here, not checked against the allowed values; that check is #41's job. A missing or garbage `id` becomes `NaN` rather than `undefined`.

\## Follow-ups noticed
- **#41 (validation)**: it may want to reject `NaN` ids, empty `created`/`updated`, and unknown status/priority values that `parseIssue` now lets through as strings.
- **Possible security issue, not in this change**: `src/core/config.ts` calls `yaml.load(yamlStr)` with no schema. On the bundled js-yaml 3.x that defaults to the full schema, which allows `!!js/function`, so a crafted `.issues/config.yml` could run code. Switching it to `CORE_SCHEMA` or the safe schema would fix this and probably deserves its own issue.
