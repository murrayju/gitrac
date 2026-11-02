---
id: 127
title: Close an issue as a duplicate of another issue
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-11-02T04:01:59.991Z'
createdBy: Justin Murray
updated: '2026-11-02T04:02:01.118Z'
---

Close an issue as a duplicate of another one, and record the link.

## Design

- New optional frontmatter field `duplicateOf: <id>` (written only when set, like `parent`). The inverse ("duplicates") is derived, never stored.
- New optional config key `duplicateStatus` (a closed status). Unset: `duplicate` if it is a configured closed status, else none. `duplicate` joins the built-in statuses (after `cancelled`) and the plain names that are closed by default.
- `gitrac close <id> --duplicate-of <other>` (also on `gitrac commit`) and `PATCH /api/issues/:id/close { duplicateOf }`: set the duplicate status and `duplicateOf`. Rejects: self, a missing target, a cycle (#a dup of #b dup of #a), combining with `--status` / `--cancelled`, and no duplicate status configured (exit 2 / 400).
- `duplicateOf` is dropped when the issue leaves the duplicate status (reopen, edit of the status, forced claim).
- Shown in `show` (`Duplicate of:` / `Duplicates:`), `show -o json` `dependencies.duplicateOf` / `duplicates`, and the web UI links panel. Picking the duplicate status in the web UI asks for the original issue.
- Other operations treat it as a link: `delete` removes it from issues that point at the deleted one, `renumber --update-refs` repoints it, the merge driver merges it as a single value.
