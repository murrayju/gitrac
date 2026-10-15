---
id: 90
title: No-op web edits create commits that only bump updated
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T17:16:25.173Z'
createdBy: Justin Murray
updated: '2026-10-15T19:55:48.588Z'
---

Found by the #74 subagent. Clicking into a description that ends in a code block (or another non-paragraph block) makes StarterKit append an empty trailing paragraph. That counts as an edit, so autosave PATCHes a description that is semantically unchanged, and gitrac commits `issue: edit #N` with only `updated` changed. The amend tracker only drops no-ops when it is *amending*; a fresh no-op commit is kept.

## Acceptance criteria

- Service layer: an update whose fields are all unchanged after normalization (e.g. description equal after trimming and normalizing trailing empty paragraphs/whitespace) writes nothing, doesn't bump `updated`, makes no commit, and returns the current issue with an indication that nothing changed. Applies to CLI `edit` too.
- UI: the description editor doesn't send a PATCH when the serialized markdown equals the last saved markdown (after the same normalization).
- Tests for both.

---

### Justin Murray — 2026-10-15T19:55:48.588Z

\## #90: a no-op edit no longer writes, bumps `updated` or commits

**What was wrong:** Clicking into a description that ends in a code block, list or quote makes Tiptap's TrailingNode add an empty paragraph. That fires an editor update, so autosave sent a PATCH with the same markdown. `updateIssue` always set `updated`, rewrote the file and committed, so every click produced an `issue: edit #N` commit that only changed `updated`. In a happy-dom test I confirmed that one click fires one update and the serialized markdown stays the same.

**What changed:**
- **Comparison rule** (`src/core/description.ts`, new): two descriptions count as the same if they match after trimming leading/trailing whitespace. That is exactly what an issue file can store, because the parser already trims the body. Whitespace inside the text still counts as a change, including trailing double spaces (a markdown hard break).
- **Service** (`src/service/issues.ts`): `updateIssue` now returns `UpdateResult = IssueChange & { changed }`, following the existing `LinkResult` pattern.
  - Only fields that actually differ are applied. Label order counts as a difference, and descriptions use the rule above.
  - If nothing differs and there's no non-blank comment, it returns `{ changed: false, issue: <as stored>, paths: [], commit: null }`. It writes nothing, keeps `updated` and doesn't call `onWritten`.
  - When another field does change, a description that only differs in surrounding whitespace keeps the stored text.
  - The precondition still runs, so a stale `If-Match` is still a 409 even for a no-op.
- **Web route:** no code change was needed. `respondWithIssue` re-reads the file from disk, so a no-op returns 200 with the current issue and its current ETag. There is a test for this.
- **CLI `edit`** (`src/cli/commands/edit.ts`):
  - **No flags at all** is a usage error: exit 2, `invalid_input`, "Nothing to edit: …". This matches what `link`/`unlink` already do.
  - **Values equal to the current ones** exit 0 with `Issue #N already has these values; nothing changed.` on stderr, and stdout still shows the issue in the `-o` format.
  - **`-c` on its own** counts as a change.
- **UI:**
  - New `needsSave()` in `src/web/ui/lib/description-sync.ts`. `DescriptionEditor` checks it just before sending (not when queuing, so typing something and deleting it while a save is in flight still gets saved). It skips the save when the markdown matches the base it's editing from.
  - It also skips content that is exactly the editor's own serialization of the description as loaded, as long as the base hasn't moved since. This stops a click from rewriting `* a` as `- a`, or wiping out syntax the editor can't represent.
  - `IssueEditor` exposes a new `loadedMarkdown()` handle, recorded when the editor is created and on each `setContent`.
  - A skipped save marks the edits as saved and clears any old save error.
- **Docs:** `edit` and `PATCH /api/issues/:id` no-op behaviour and the autosave skip are in `docs/specs/2026-03-28-gitrac-design.md`; the `edit` row in `skills/using-gitrac/SKILL.md` is updated.

**Tests (all fail without the fix):**
- `src/core/description.test.ts`
- `src/service/issues.test.ts`: no-op, precondition, what counts as a change, kept description.
- `src/cli/commands/edit.test.ts` (new): no-op makes no commit and leaves the file untouched, real change, comment-only, no-flags error.
- `src/web/routes/issues-conflict.test.ts`: no-op PATCH gives 200 with the same ETag and no commit; stale `If-Match` gives 409.
- `src/web/ui/lib/description-sync.test.ts`
- `src/web/ui/lib/description-noop.test.ts` (new): real Tiptap editor, clicking into a code block, quote or list doesn't need a save; typing does.

`./bun run check` passes (1205 tests) and the Vite build succeeds.

**Decisions / trade-offs:**
- The comparison only ignores leading/trailing whitespace. Line endings and whitespace inside the text are left alone.
- A no-op doesn't fix a misnamed or misplaced file, and doesn't register labels that were never added to `config.yaml`. "Writes nothing" is the rule.
- Picking the current value in a metadata dropdown is now a no-op too.

**Related things I noticed:**
- #89: the editor has no table extension, so a table serializes to plain text (`| a | b |…` becomes `ab12`). Clicking in no longer saves that, but any real edit to such an issue still loses the table.
- Other `IssueChange` operations (`editComment` with the same body, `claim`) still always write. Out of scope here.

**Orchestrator browser verification:** on the demo repo, clicking into a description ending in an ordered list and into its code block sent no PATCH and created no commit; typing a real edit afterwards sent exactly one PATCH and one `issue: edit #4` commit.
