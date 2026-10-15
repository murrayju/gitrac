---
id: 90
title: No-op web edits create commits that only bump updated
status: todo
priority: medium
assignee: ''
labels:
  - bug
created: '2026-10-15T17:16:25.173Z'
createdBy: Justin Murray
updated: '2026-10-15T17:16:25.173Z'
---

Found by the #74 subagent. Clicking into a description that ends in a code block (or another non-paragraph block) makes StarterKit append an empty trailing paragraph. That counts as an edit, so autosave PATCHes a description that is semantically unchanged, and gitrac commits `issue: edit #N` with only `updated` changed. The amend tracker only drops no-ops when it is *amending*; a fresh no-op commit is kept.

## Acceptance criteria

- Service layer: an update whose fields are all unchanged after normalization (e.g. description equal after trimming and normalizing trailing empty paragraphs/whitespace) writes nothing, doesn't bump `updated`, makes no commit, and returns the current issue with an indication that nothing changed. Applies to CLI `edit` too.
- UI: the description editor doesn't send a PATCH when the serialized markdown equals the last saved markdown (after the same normalization).
- Tests for both.
