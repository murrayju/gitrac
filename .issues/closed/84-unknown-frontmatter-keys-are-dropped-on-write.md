---
id: 84
title: Unknown frontmatter keys are dropped on write
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-15T16:07:07.351Z'
createdBy: Justin Murray
updated: '2026-10-15T18:38:02.216Z'
---

`serializeIssue` only writes known fields, so any custom frontmatter (`estimate:`, `externalId:`, `sprint:`) added by hand or by another tool silently disappears on the next gitrac write. The design spec lists custom fields / external sync IDs as future work, and dropping data is the opposite of that.

## Acceptance criteria

- Unknown frontmatter keys are preserved verbatim (values and order, written after the known keys) through every read/modify/write, including the merge driver (merge them per key, three-way).
- Exposed in `-o json` / the API under a separate `extra` (or similar) object so they don't collide with known fields. Not editable through the CLI/UI yet.
- The round-trip-every-issue-file test still passes; new tests for preservation.

---

### Justin Murray — 2026-10-15T18:38:02.216Z

Unknown frontmatter keys now survive every gitrac write, including the web PATCH path, every service operation and the merge driver. They show up read-only under `extra` in `-o json`/`-o yaml` and the API. `./bun run check` passes (1158 tests), including the test that round-trips every file in `.issues/` byte-for-byte.

**What was wrong**
`serializeIssue` (`src/core/issue.ts`) only wrote the known fields, and the merge driver rebuilt frontmatter field by field (`frontmatterOf` / `mergeIssueFrontmatter` in `src/git/conflict.ts`). So hand-added keys like `estimate:`, `externalId:` or `sprint:` disappeared on the next CLI/web write or merge.

**What changed**
- **Types** (`src/core/types.ts`): new optional `Issue.extra` / `IssueFrontmatter.extra`. It only exists when the file has unknown keys, so the JSON output and the existing tests for files without them don't change.
- **Reading** (`src/core/issue.ts`):
  - Every key outside the known set goes into `extra`, in file order, with the same core-schema values gitrac already uses. Known keys never end up there.
  - Each key's original text is also kept: the raw frontmatter is split into one block per top-level key, together with any comment lines just above it.
  - That split is only trusted if each block parses back to exactly the key's value. If it doesn't (e.g. an anchor shared between keys), the values are written out fresh instead of from the original text.
- **Writing**: known keys are written first, unchanged and in their usual order. Unknown keys follow before the closing `---`. An unchanged key is written as its original text (quoting, flow style, trailing `# comments`); a changed or hand-built value is written fresh as YAML.
  - So `sprint: 2026-03-28` stays unquoted. Writing it fresh would add quotes, which changes the type for tools that read it as a date.
- **Why the original text stays attached**: it is stored in a module-level `WeakMap` keyed by the `extra` object. That way it follows the issue through in-place service changes and `{ ...issue }` copies, and never appears in JSON output.
- **Merge driver** (`src/git/conflict.ts`): `mergeExtra` merges unknown keys one at a time, three-way:
  - A one-sided add, change or removal wins.
  - Changed on both sides: the side with the later `updated` wins (same as the other fields).
  - Removed on one side but changed on the other: the change is kept.
  - Order is ours' keys first, then keys only theirs has. Merged values keep their original text via a new `pickExtraFields` helper.
- **Not editable**: the update path only reads the fields it knows, so an `extra` field in CLI or PATCH input is ignored; tests cover this.

**Decisions / trade-offs**
- Comment lines inside the frontmatter only survive if they sit directly above an unknown key. That's no worse than before.
- Keys that look like integers keep their file order, even though JS objects list them first.
- A `__proto__` key is stored as ordinary data and can't change any object's prototype.

**Files**
- Code: `src/core/types.ts`, `src/core/issue.ts`, `src/git/conflict.ts`
- Tests:
  - `src/core/issue.test.ts`: round-trip, ordering, changed values, fallback, `__proto__`.
  - `src/git/conflict.test.ts`: per-key three-way merge, kept verbatim.
  - New `src/service/extra-fields.test.ts`: update, comment add/edit/delete, claim/unclaim, link/unlink, close/reopen, `next --claim`, renumber, and being unlinked when a blocker is deleted.
  - `src/web/routes/issues.test.ts`: GET exposes `extra`, PATCH keeps it.
- Docs: `docs/specs/2026-03-28-gitrac-design.md` (file format, merge-driver frontmatter rules, the "Robustness" note that used to say unknown keys are dropped), `skills/using-gitrac/SKILL.md`, `AGENTS.md`.

**Follow-ups / interactions**
- #86 (atomic writes in `issue-store.ts`) only calls `serializeIssue`, so there's no overlap.
- Human-readable `show` doesn't list the extra keys; I left that out of scope.
- Any future code that copies issue frontmatter field by field has to carry `extra` along. `AGENTS.md` now says so.
