---
id: 43
title: CLI cannot set an issue description
status: done
priority: high
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T23:29:28.002Z'
---

Neither `create` nor `edit` accepts a description. Agents therefore can't create well-specified issues without editing the markdown file directly, which the skill explicitly says not to do.

## Acceptance criteria

- `create` and `edit` accept `-d, --description <text>`, `--description-file <path>` (`-` for stdin).
- `comment` accepts `--body-file <path|->` too (currently only positional or implicit stdin).
- Update AGENTS.md / skill docs.

---

### Justin Murray — 2026-10-14T23:29:28.002Z

\## #43: CLI can now set issue descriptions and read comment bodies from a file

**What was wrong**
`create` and `edit` had no way to set a description. `comment` only took its body as an argument or from piped stdin. Agents couldn't write a well-specified issue without editing the markdown file by hand, which the skill tells them not to do.

**What changed**
- **`create` / `edit`:** new `-d, --description <text>` and `--description-file <path|->` options (`-` reads stdin). Both go through `validateIssueFields` like the other fields. `edit` replaces the whole description and leaves comments alone; `edit -d ""` clears it. Leaving both flags off changes nothing.
- **`comment`:** new `-F, --body-file <path|->` option. The old ways (argument, piped stdin) still work.
- **New helper `src/cli/text-input.ts`:**
  - `readStdin` (moved here from `comment.ts`), `readTextSource` and `resolveTextOption` / `resolveTextOptionOrExit`.
  - Passing both the inline and the file form is an error: exit 1, nothing written.
  - A missing file gives a clean `Error: ... file not found: <path>` with exit 1 and no stack trace.
  - Input is trimmed, because the issue parser trims descriptions on read-back anyway.
- All input, including stdin, is read **before** `withMutationLock` (per AGENTS.md). In `edit` this means the description is resolved before the lock is taken.

**Files**
- `src/cli/text-input.ts` (new)
- `src/cli/text-input.test.ts` (new, 23 tests)
- `src/cli/commands/create.ts`, `edit.ts`, `comment.ts`
- `AGENTS.md`, `skills/using-gitrac/SKILL.md` (quick reference, create flags, a heredoc example for multi-line descriptions)
- `docs/specs/2026-03-28-gitrac-design.md`: new "Text Input" section; the outdated "edit is metadata only" note is gone.

**Decisions / trade-offs**
- `-d` is free because the global `--dir` has no short flag.
- I added `-F` as a short form of `--body-file` (like `git commit -F`). The issue didn't ask for it.
- Relative file paths are resolved against the current working directory, not `--dir`, which matches what a user typing a path would expect. This is documented.
- Small behaviour change: positional comment bodies are now trimmed too. An explicit `comment <id> ""` now fails with "Comment body is required" instead of falling back to stdin.
- Explicit `-` always reads stdin, even from a TTY (end input with Ctrl-D). The implicit fallback in `comment` still only reads when stdin is piped.

**Tests**
- The new tests cover inline text, files, stdin, paths relative to the cwd, both forms given, a missing file, an empty body, clearing with `edit -d ""`, comments surviving an edit, and a description containing a fake comment separator `---` that must round-trip.
- `./bun run check` passes: 513 tests.

**Follow-ups / interactions**
- `create --description-file -` without `-t` uses up stdin before the title prompt runs, so the prompt then fails with "Title is required". Pass `-t` when piping.
- `edit` still bumps `updated` and commits even when no fields change (existing behaviour, out of scope).
- For #45 (web optimistic concurrency): CLI description edits change files under the web editor, so they're exactly the kind of concurrent change that work needs to detect.
