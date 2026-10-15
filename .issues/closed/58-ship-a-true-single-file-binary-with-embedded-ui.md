---
id: 58
title: Ship a true single-file binary with embedded UI
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T02:18:33.029Z'
---

The spec promises a single binary with embedded assets, but releases ship a tarball of binary + `dist/ui/` and the server searches for `dist/ui` next to the executable or in the project dir (the latter means running in a repo with an unrelated `dist/ui` would serve the wrong UI).

Embed the Vite output in the compiled binary (e.g. Bun `import ... with { type: 'file' }` / embedded file manifest) and serve from memory; drop the cwd fallback outside dev mode.

---

### Justin Murray — 2026-10-15T02:18:33.029Z

Issue #58 is fixed: the compiled binary now carries the whole web UI inside it and serves it from memory, so nothing needs to sit beside it on disk. `./bun run check` passes (773 tests).

**What was wrong**
- The spec promised a single binary, but releases shipped a tarball of the binary plus `dist/ui/`.
- `findUiDistDir` looked for `dist/ui` next to the bun executable, then in the project being served. A repo with an unrelated `dist/ui` got its own UI served instead of gitrac's.
- Running from source (`./gitrac`) against another repo found no UI at all.

**What changed**
- **New `src/web/ui-assets.ts`:** defines a small UI-files source (`UiAssets`) with two implementations: one backed by an embedded file list, one reading a directory on disk. `resolveUiAssets()` picks which to use:
  1. **Compiled binary:** the embedded files only.
  2. **From source:** gitrac's own `dist/ui`, found relative to the gitrac source tree. It is skipped inside a compiled binary, where module paths are virtual.
  3. **Otherwise:** API only. Startup prints a warning to stderr saying the UI isn't built.
- The cwd, project-dir and executable-dir lookups are gone. The directory source rejects `..`, encoded traversal, absolute paths, NUL bytes and bad percent-encoding.
- **`src/web/server.ts`:** replaced `serveStatic` and `findUiDistDir` with one GET handler.
  - It serves the file if it exists, otherwise falls back to `index.html` for SPA routes.
  - Content-type comes from the URL path.
  - Vite's hashed `/assets/*` files are sent with a long-lived, immutable cache header. A missing one returns 404 rather than HTML (a small behaviour change).
  - `index.html` is sent with `no-cache`.
  - `AppOptions.ui` lets callers inject a UI source; `null` means API only.
- **`scripts/build.ts`:** after the Vite build, it writes `dist/gitrac-entry.ts`, which imports every `dist/ui` file `with { type: 'file' }` (embedding it), registers them, then runs the CLI. That generated file is what gets compiled. The build fails clearly if `dist/ui/index.html` is missing (e.g. `--skip-ui` with no earlier UI build).
- **`.github/workflows/publish.yml`:** the tarball now holds only the binary (tarred to keep the executable bit).
- **Docs:** the spec's "Build" section now explains how the UI is found; `AGENTS.md` and `skills/using-gitrac/SKILL.md` got matching small notes.

**Files:** `src/web/ui-assets.ts` (new), `src/web/ui-assets.test.ts` (new), `src/web/server.ts`, `src/web/server.test.ts`, `scripts/build.ts`, `.github/workflows/publish.yml`, `AGENTS.md`, `docs/specs/2026-03-28-gitrac-design.md`, `skills/using-gitrac/SKILL.md`.

**Tests**
- Regression test: a project's own `dist/ui` is never served. This fails against the old code.
- The embedded files are served by default, with correct content-types and cache headers, SPA fallback, 404 for a missing hashed asset, and HEAD.
- Path-traversal attempts against the directory source are rejected.
- `resolveUiAssets` prefers the embedded UI; compiled-binary detection works.
- The existing SPA tests now pass in a UI source explicitly instead of creating `dist/ui` in the project dir.

**Manual check**
- Built with `./bun run scripts/build.ts`, both plain and with `--minify --sourcemap`.
- Ran the binary in a scratch git repo that contained a decoy `dist/ui`:
  - `/` returned the real gitrac UI, not the decoy.
  - The hashed JS asset returned 200 as `text/javascript` with the immutable header.
  - `/issues/3` fell back to `index.html`, a missing asset returned 404, and `/api/issues` worked.
- With the source tree's `dist/ui` renamed away and the binary copied to an isolated dir, it still served `/` with a 200.
- `./gitrac serve` run from a subdirectory of another repo served gitrac's own source-tree UI.

**Decisions / trade-offs**
- The generated entry is used instead of `Bun.embeddedFiles` because entry points passed that way are bundled as code rather than embedded as files, so the UI's JS files wouldn't be included as-is.
- `index.ts` is unchanged, so `./gitrac`, the Vite dev server proxy and the tests behave as before.
- From source, files are read from disk on each request, so a `vite build --watch` rebuild shows up without restarting.

**Follow-ups noticed (not changed)**
- Unknown GET `/api/*` paths still fall through to `index.html`, as before. A JSON 404 would be cleaner.
- `scripts/` isn't covered by the `tsconfig` `include`, so `./bun run typecheck` doesn't check `build.ts`. I checked it with a one-off `tsc`.
- An untracked `download` entry was already in the working tree; I left it alone.
