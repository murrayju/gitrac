---
id: 127
title: Close an issue as a duplicate of another issue
status: backlog
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-11-02T04:01:59.991Z'
createdBy: Justin Murray
updated: '2026-11-02T17:17:17.295Z'
---

Close an issue as a duplicate of another one, and record the link.

## Design

- New optional frontmatter field `duplicateOf: <id>` (written only when set, like `parent`). The inverse ("duplicates") is derived, never stored.
- New optional config key `duplicateStatus` (a closed status). Unset: `duplicate` if it is a configured closed status, else none. `duplicate` joins the built-in statuses (after `cancelled`) and the plain names that are closed by default.
- `gitrac close <id> --duplicate-of <other>` (also on `gitrac commit`) and `PATCH /api/issues/:id/close { duplicateOf }`: set the duplicate status and `duplicateOf`. Rejects: self, a missing target, a cycle (#a dup of #b dup of #a), combining with `--status` / `--cancelled`, and no duplicate status configured (exit 2 / 400).
- `duplicateOf` is dropped when the issue leaves the duplicate status (reopen, edit of the status, forced claim).
- Shown in `show` (`Duplicate of:` / `Duplicates:`), `show -o json` `dependencies.duplicateOf` / `duplicates`, and the web UI links panel. Picking the duplicate status in the web UI asks for the original issue.
- Other operations treat it as a link: `delete` removes it from issues that point at the deleted one, `renumber --update-refs` repoints it, the merge driver merges it as a single value.

---

### Justin Murray — 2026-11-02T04:45:16.933Z

Close an issue as a duplicate of another, with a link.

- Data: optional frontmatter duplicateOf: <id> (written only when set, after blockedBy). Inverse (duplicates) derived. Merge driver merges it as a single field.
- Workflow: optional config key duplicateStatus (closed). Unset: duplicate if configured closed, else none. duplicate joins the built-in statuses and the plain names that are closed by default. This repo's config gets it.
- CLI: close/commit --duplicate-of <id>; edit --duplicate-of <id> (needs the duplicate status, works on closed issues). show lists Original: / Duplicates:; -o json dependencies.duplicateOf / duplicates.
- Service: closeIssue / updateIssue validate (duplicateOfError: not itself, must exist, no cycle; no combo with status/cancelled; needs a duplicate status). dropDuplicateLink removes the link on reopen, status edit, forced claim. delete clears it on duplicates of the deleted issue; renumber reports it and --update-refs repoints it.
- Web: PATCH /api/issues/:id/close { duplicateOf } and PATCH /api/issues/:id { status, duplicateOf }. Picking the duplicate status in the UI asks for the original issue; the links panel shows Duplicate of / Duplicates. Purple badge for duplicate.
- Docs: spec, README, skill, AGENTS.md.

### Justin Murray — 2026-11-02T15:00:32.655Z

Reworking: replace the scalar duplicateOf (and parent / blockedBy) with a general links field, with a config version migration.

### Justin Murray — 2026-11-02T15:52:47.972Z

Replaced the scalar duplicateOf (and parent / blockedBy) with a general links field, and versioned the .issues/ format.

- Data (src/core/links.ts): links is a list of { type, ... }. issue: { relationship, id } with blockedBy, blocks, parent, child, duplicateOf, duplicatedBy, related. url: { url, title? }. github-pr: { repo, number } (GitHub PR URLs become these). Unknown types are kept verbatim. A link between two issues is stored on one side only; LinkGraph derives every relation from all issues' links. A new parent / duplicateOf replaces the old one wherever it is stored; unlink removes a relation whichever issue stores it (rewriting that file in the same commit). Cycle checks work from either side.
- Format versioning: CONFIG_VERSION = 2. Every CLI command (and serve, and a web branch switch) migrates an older .issues/ once (migrateProject: rewrite files with parent / blockedBy / duplicateOf into links, bump config version, one commit; skipped during a merge/rebase). A newer config version prints a warning on stderr for every command and a red banner (plus console.warn) in the web UI. The old fields are still read, so files merged from older branches work.
- Duplicates: close/commit --duplicate-of and PATCH close { duplicateOf } set the duplicate status and add a duplicateOf link in one commit. The link no longer depends on the status (reopen keeps it). Removed edit --duplicate-of and PATCH { duplicateOf }.
- CLI: link/unlink take one option per relationship plus --url (and --title); show lists Parent, Sub-issues, Blocked by, Blocks, Original, Duplicates, Related, Links. delete / renumber report relationships[].
- API: POST /issues/:id/link and /unlink take { links: [...] }; dependencies adds related.
- Web UI: links panel lists every relation with remove buttons, a relationship select + issue number to add, and URL / PR links with an add input. The duplicate status prompt links then sets the status.
- Merge driver merges links as a keyed set and converts version-1 sides.
- This repo's .issues/ is migrated to version 2 in this commit. Docs: spec, README, skill, AGENTS.md, www.

### Justin Murray — 2026-11-02T17:17:17.295Z

Follow-up: store each issue link on a fixed home issue (the dependent one), so an issue's file reliably lists what constrains it; index the link graph.
