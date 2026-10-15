---
id: 58
title: Ship a true single-file binary with embedded UI
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T01:50:50.345Z'
---

The spec promises a single binary with embedded assets, but releases ship a tarball of binary + `dist/ui/` and the server searches for `dist/ui` next to the executable or in the project dir (the latter means running in a repo with an unrelated `dist/ui` would serve the wrong UI).

Embed the Vite output in the compiled binary (e.g. Bun `import ... with { type: 'file' }` / embedded file manifest) and serve from memory; drop the cwd fallback outside dev mode.
