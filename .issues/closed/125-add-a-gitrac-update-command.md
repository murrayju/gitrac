---
id: 125
title: Add a `gitrac update` command
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-31T14:05:36.872Z'
createdBy: Justin Murray
updated: '2026-10-31T14:55:38.505Z'
---

Add a command to self-update the binary. This should detect the installation method, and update according to its conventions. Add `upgrade` as an alias.

---

### Justin Murray — 2026-10-31T14:55:38.505Z

Added `gitrac update` (alias `upgrade`, `--check` to only report).

Install method is detected from the real path of the running executable (src/core/install-method.ts, pure + tested against the real layouts of npm, pnpm 11, bun, npx, bunx and pnpm dlx):
- standalone binary (install.sh, download, local build): latest version from the GitHub releases/latest redirect; downloads gitrac-<os>-<arch> next to the binary, checks it runs and reports that version, then renames it over the old one (atomic; failures leave the old binary).
- npm / pnpm / bun / yarn global install: latest version from the npm registry, then runs that package manager (npm keeps the install's --prefix). Output goes to stderr with -o json/yaml.
- source checkout, npx/bunx/pnpm dlx, project dependency: exit 3 (invalid_state) with what to do instead.
Never downgrades. -o json gives { method, current, latest, updated, path | command }.

Verified end to end with a compiled 0.2.0 binary (standalone and inside an npm prefix) updating itself to the real 0.2.1 release, and the read-only directory error. Note: Bun.write(path, Response) hangs for the 100 MB download in Bun 1.3.11, so the body is streamed to a file handle.

Docs: README, design spec (command table + exit 3), skill, releasing.md and AGENTS.md (releaseAssetName must stay in sync with the platform matrix).
