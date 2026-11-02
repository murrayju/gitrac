---
id: 126
title: 'Web UI: detect and resolve duplicate issue IDs'
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-11-02T01:41:28.374Z'
createdBy: Justin Murray
updated: '2026-11-02T02:14:09.925Z'
---

Opening an issue whose ID has several files (e.g. two clones created the same ID) shows only a raw `API error 409 ... duplicate_issue` message in the web UI.

The web UI should make it easy to resolve this:

- Detect every duplicated ID when the UI loads (and again on each issue change); the server also warns at startup.
- Show the suggested renumbering: the oldest file (by `created`) keeps the ID, every other file gets the next free ID.
- A button applies it (`renumberIssue` per file, one commit each).
- A manual override: pick which file keeps the ID.

---

### Justin Murray — 2026-11-02T02:14:09.925Z

Web UI resolves duplicate issue IDs.

- Service (src/service/renumber.ts): duplicateIssueIds lists every ID with several files, ordered by keepOrder (unparseable first, then oldest created, then path), with previewed new IDs (nextIssueId, a read-only peek of allocateIssueId in src/git/ids.ts). resolveDuplicateId keeps one file (default: the oldest; keep overrides) and renumbers the others with renumberIssue under the repo lock, one commit each. RenumberCandidate now carries created.
- API (src/web/routes/duplicates.ts): GET /api/duplicates, POST /api/duplicates/:id/resolve { keep? }.
- UI: amber banner while duplicates exist, /duplicates page (radio per file to pick the keeper, previewed #old -> #new, Apply per ID and Apply all), and /issues/:id of a duplicated ID shows the same resolver instead of the raw 409. A notice lists what was renumbered and the issues that link to or mention the old ID.
- gitrac serve warns at startup when IDs are duplicated.
- Docs: spec (Renumbering, API routes, React UI), skill, AGENTS.md.
