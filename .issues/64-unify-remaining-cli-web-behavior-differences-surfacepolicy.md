---
id: 64
title: Unify remaining CLI/web behavior differences (SurfacePolicy)
status: todo
priority: low
assignee: ''
labels:
  - chore
created: '2026-10-15T01:16:55.011Z'
createdBy: Justin Murray
updated: '2026-10-15T01:16:55.011Z'
---

Follow-ups from the #51 service-layer refactor, which deliberately preserved existing CLI/web differences via `SurfacePolicy` (`CLI_POLICY` / `WEB_POLICY` in `src/service/`). Decide on one behavior for each and remove the switch:

- Asset files are only committed by web operations (CLI-created comments referencing assets don't commit them); `deleteComment` never commits assets.
- Field edits are committed as `edit #N` (CLI) vs `update #N` (web); web comment messages include the issue title, CLI's don't.
- CLI `edit` always includes `config.yaml` in the commit even when unchanged.
- CLI `-c` comments aren't trimmed; web comments are.
- Bad reopen status: CLI reports the status error first, web reports issue errors (404/409) first.
- Web never pushes (ignores `autoPush`).
- `PATCH /api/config/*` with a non-JSON / `null` body returns 500 instead of 400.
- `edit` on a file without frontmatter prints `# #NaN: …` — malformed issue files should produce a clear `invalid_issue` error.
- Claim/unclaim error messages mention CLI flags (`--force`, `gitrac reopen`); make messages surface-neutral (or let adapters supply hints) before adding a web claim route.
