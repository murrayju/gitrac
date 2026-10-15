---
id: 89
title: Markdown tables don't render in the web UI
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-15T16:51:32.861Z'
createdBy: Justin Murray
updated: '2026-10-15T20:33:57.852Z'
---

Found by the #73 subagent. Tiptap's StarterKit has no table support, so markdown tables in descriptions and comments don't render as tables (and editing a description containing a table may mangle it on autosave).

## Acceptance criteria

- Add Tiptap's table extensions so GFM tables render in the editor, read-only markdown and comments.
- Round-trip check: a description containing a table, opened and saved in the editor without edits, produces identical markdown (or the editor doesn't save at all). Add a regression test for the markdown serializer.
- Prose table styles (from #73) apply.

---

### Justin Murray — 2026-10-15T20:33:57.852Z

GFM tables now render as real tables in every markdown surface. Opening or clicking around a description with a table never saves it, and editing one writes it back as a GFM table. `./bun run check` passes (1259 tests) and the Vite build succeeds; the result still needs your browser check.

**What was wrong**
StarterKit has no table nodes, so tables parsed by markdown-it were turned into plain text (and could be mangled on autosave). Adding `@tiptap/extension-table` alone wasn't enough, because tiptap-markdown's own table serializer:
- drops column alignment (`:---:` becomes `---`);
- doesn't escape `|` inside cells, so a cell containing `a \| b` comes back as two cells and the data is corrupted;
- writes the literal text `[table]` (with `html: false`) for any table it can't express in GFM. Editing can produce such a table easily: Enter or Shift‑Enter in a cell, merged cells, or no header row.

**What changed**
- **New `src/web/ui/lib/table-extensions.ts`:** exports `tableExtensions` (Table, TableRow, TableHeader, TableCell) with:
  - an `align` attribute on header and body cells, read from markdown-it's `text-align` style and rendered back the same way;
  - its own GFM serializer for the table node. It writes `| a | b |` rows and a delimiter row that keeps alignment, escapes every `|` in a cell as `\|`, and puts each cell on one line.
  - Each cell is rendered in a separate serializer state, so tiptap-markdown's block spacing and bold/italic bookkeeping can't leak into the row.
  - Unusual tables are flattened, never lost: a hard break or second paragraph in a cell becomes a space, merged cells are padded with empty cells, and the first row is always treated as the header.
- **Editor setup:** added `...tableExtensions` to all four editors: `IssueEditor`, `MarkdownContent`, `CommentList`'s inline editor and `CommentEditor`.
- **`globals.css`:** Tiptap puts header cells in `<tbody>`, with no `<thead>`, so the typography plugin's `thead th` styles never reach them. I copied those styles onto `.tiptap.prose th` (weight, colour, padding, header border colour) and removed the paragraph margins inside cells. Inline alignment styles still take precedence. I also added a highlight for selected cells.
- **Dependency:** added `@tiptap/extension-table` with range `^3.21.0`, locked at 3.21.0. Newer releases require exactly matching `@tiptap/core`/`pm` versions, so a future upgrade has to bump all `@tiptap/*` packages together.
- **Spec:** added a "Tables" paragraph to `docs/specs/2026-03-28-gitrac-design.md` covering serialization, round-trip guarantees and flattening.

**Tests** (in the real editor under happy-dom)
- **New `table-extensions.test.ts`:**
  - Tables render with header cells, alignment, inline code and links.
  - A typical table (alignment row, inline code, links, bold/italic, escaped pipes, empty cell, `#12`) comes back byte for byte, including inside a list, a blockquote or around other text, and with an image in a cell.
  - Other table spellings are rewritten into that form without being mangled.
  - Clicking into a cell, then after the table, needs no save; typing in a cell does.
  - Enter, Shift‑Enter, merged cells and removing the header row never produce `[table]`.
- Five of the new tests fail when the table extensions are used without the custom serializer.
- I added a table case to `description-noop.test.ts` (#90) and a CSS check to `globals.test.ts`.

**Round-trip behaviour**
- A table already in the canonical form above round-trips byte for byte.
- Other spellings (`|a|b|`, `|-|`, padded columns, short rows) load fine. The #90 `needsSave` check skips saving because the result equals the editor's own reading of the loaded text, so they are only rewritten in canonical form on the next real edit.

**Limitations**
- There's no table toolbar. Tables come from markdown or a paste; Tab/Shift‑Tab move between cells, and Tab in the last cell adds a row.
- Very wide tables wrap or overflow inside the editor; I didn't add horizontal scrolling.

**Follow-ups noticed (not fixed)**
- The four editors each build their own nearly identical extension list. A shared base list would stop them drifting apart; for now `tableExtensions` is the shared piece.

**Orchestrator browser verification:** a GFM table with `:---`/`---:`/`:---:` alignment, inline code and a `#4` reference (written via `gitrac edit -d`) renders as a real table in the description editor with per-column alignment and a linked `#4`; clicking into a cell created no commit.
