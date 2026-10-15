---
id: 82
title: Interactive prompts write to stdout
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T16:07:05.541Z'
createdBy: Justin Murray
updated: '2026-10-15T17:41:20.649Z'
---

`gitrac create` without `-t` prints the `Issue title: ` prompt to stdout, and does so even when stdin is not a TTY. That pollutes machine-readable output.

## Acceptance criteria

- All interactive prompts (create title, delete confirmation, renumber file choice) write to stderr.
- They only prompt when stdin is a TTY. Otherwise: create without a title fails with `invalid_input` (exit 2) and a clear message.
- Tests.

---

### Justin Murray — 2026-10-15T17:41:20.649Z

**Summary: interactive prompts now go to stderr and only appear on a terminal (#82)**

**What was wrong**
`create` (when run without `-t`), `delete` and `renumber` used Bun's global `prompt()`, which writes the question to **stdout**. That broke machine-readable output such as `-o json`. `create` also asked for a title even when stdin wasn't a terminal: it silently read the title from piped stdin, or printed `Issue title: ` into an agent's output. `delete` and `renumber` already only asked on a terminal; only where their question was printed was wrong.

**What changed**
- **New shared helper, `src/cli/prompt.ts`:**
  - `stdinIsTTY()` reports whether stdin is a terminal.
  - `promptLine(question, streams?)` writes `question ` to stderr and reads one line from stdin. It returns `null` on EOF (Ctrl-D). The streams can be swapped out in tests.
- **`create`:** a new exported `askTitle()` asks for the title (on stderr) only when stdin is a terminal. Without a terminal it fails with `invalid_input` (exit 2): `Title is required: pass -t, --title <title> (stdin is not a terminal, so it was not asked for).` A blank answer or EOF is also `invalid_input`, and the title is now trimmed.
- **`delete` / `renumber`:** their default prompt now uses `promptLine`. Because of that, the `prompt` they accept (the `DeleteIO` / `RenumberIO` interfaces) now returns `Promise<string | null>`, and `chooseFile` in `renumber` is async.

**Tests**
- **New `src/cli/prompt.test.ts`:**
  - `promptLine` writes to the stream it's given, defaults to stderr and never stdout, and returns `null` on EOF.
  - `askTitle` asks on a terminal, rejects a blank answer or EOF, and doesn't ask without a terminal.
  - Running the CLI without a terminal: `create` with a piped title exits 2 with empty stdout and creates no file; `-o json create` puts the JSON error on stderr; `-t` still works.
  - A source check fails if any non-test file in `src/cli` calls the global `prompt(`. It catches the old `create.ts`.
- `delete.test.ts` and `renumber.test.ts` now use async fake prompts.
- Checked by hand under a real terminal (`script`): the question appears on stderr, stdout holds only the output, and the process exits normally.
- `./bun run check` passes (1103 tests).

**Files**
- `src/cli/prompt.ts` (new), `src/cli/prompt.test.ts` (new)
- `src/cli/commands/create.ts`, `delete.ts`, `renumber.ts`
- `src/cli/commands/delete.test.ts`, `renumber.test.ts`
- `docs/specs/2026-03-28-gitrac-design.md`: replaced the "interactive mode" note under Create Flags with the stderr / terminal-only rule.
- `skills/using-gitrac/SKILL.md`: the `-t` flag note now says `create` exits 2 without it when there's no terminal.

**Decisions and trade-offs**
- **Behaviour change:** `printf 'title\n' | gitrac create` used to create an issue from the piped title. It now exits 2, as the acceptance criteria require.
- I used `node:readline` in line mode rather than raw mode, so the terminal still handles line editing and echo.
- On a terminal, `delete` still prints its plan ("Would delete …") to stdout before asking. That plan is the command's output in the chosen `-o` format, not part of the prompt, so I left it where it was.

**Follow-ups noticed**
- `create --description-file -` on a terminal without `-t` reads stdin until EOF for the description. The title prompt then gets EOF and fails with `invalid_input`. That's acceptable, but the message could say so more clearly.
