---
id: 85
title: serve --port with a non-numeric value reports NaN
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T16:07:08.274Z'
createdBy: Justin Murray
updated: '2026-10-15T19:24:57.839Z'
---

`gitrac serve --port abc` prints `Invalid port "NaN"`. The error should echo the original input and use the standard `invalid_input` error (exit 2). The same applies to `--port 99999` and other out-of-range values.

---

### Justin Murray — 2026-10-15T19:24:57.839Z

`gitrac serve --port abc` now fails with `Error: Invalid port "abc": must be an integer from 0 to 65535.` and exit 2. Out-of-range values like `99999` give the same error. `./bun run check` passes (typecheck, lint, all 1227 tests), and I confirmed both commands by hand in a scratch directory.

\## What was wrong
`resolveServeOptions` turned `-p` / `--port` into a number with `Number.parseInt` before checking it. `runServe` then reported the parsed result, so `--port abc` printed `Invalid port "NaN"` and the original input was lost. Because `parseInt` is lenient, `--port 4000abc` was also quietly accepted as port 4000.

\## What changed
- **`src/cli/commands/serve.ts`**
  - New exported `parsePort(value: string)`. It accepts only plain decimal digits from 0 to 65535 and otherwise throws the standard `invalid_input` error with the value exactly as typed.
  - `resolveServeOptions` passes the raw string to `parsePort`, from `serve -p/--port` or the program-level `--port` (default `3000`). This covers `serve`, `serve -p`, and bare `gitrac --port`.
  - The port is checked before the project root is resolved, so the port error shows first even outside a git repo.
  - `runServe` keeps its range check as a backstop for code that calls it directly, using the same message.
- **Tests (fail without the fix)**
  - `src/cli/global-options.test.ts`: the edges `0` and `65535` are accepted. The values `abc`, `99999`, `65536`, `-1`, `4000abc`, `40.5`, `0x10`, an empty string and a leading space are rejected through all three option spellings, each with the exact message and the `invalid_input` code.
  - New `src/cli/commands/serve.test.ts`: unit tests for `parsePort`, plus end-to-end runs of the real CLI checking exit 2, empty stdout, the exact stderr line, and the JSON error output with `-o json`.
- **`docs/specs/2026-03-28-gitrac-design.md`**: the `gitrac serve` row now states the port rules and the error.

\## Decisions / trade-offs
- **Raw string read in `serve.ts`:** I didn't change `GlobalOptions.port` (still a number from `parseInt`). Making it the raw string would have meant editing `src/cli/commands/delete.test.ts` and `renumber.test.ts`, which #75 and #87 are working on. `resolveServeOptions` reads the raw `--port` value directly instead, with a comment explaining why.
- **Strict parsing:** `4000abc`, `40.5`, `0x10` and `1e3` are now rejected rather than quietly truncated or converted.
- **Port 0 still allowed:** it was accepted before, so I kept it.
- **Only `serve` checks the port:** `gitrac --port abc ls` still works, because nothing else uses the port.

\## Follow-ups noticed
- `GlobalOptions.port` can still be `NaN`. Nothing reads it any more, so it could be removed (or kept as a raw string) once the delete/renumber test files are free to edit.
