---
id: 36
title: Horizontal rule in description silently truncates content
status: in_progress
priority: urgent
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T22:12:30.877Z'
---

`splitContent` in `src/core/issue.ts` treats the first `---` line after frontmatter as the description/comments separator. `parseComments` then discards any lines before the first `### author — timestamp` header.

So a description containing a horizontal rule loses everything after it:

```markdown
Part A

---

Part B after hr
```

parses as `description: "Part A"`, `comments: []`. The next save writes the truncated version to disk — permanent data loss. Tiptap's markdown serializer emits `---` for horizontal rules, so this is easy to trigger from the web UI.

## Acceptance criteria

- The separator is only recognized when it is followed (after blank lines) by a valid comment header line, or a more robust, unambiguous separator scheme is used — while staying backward compatible with existing files.
- Horizontal rules (`---`, `***`, `___`) in descriptions and comment bodies round-trip losslessly.
- Content between a separator and the first comment header is never silently dropped.
- Fence detection should handle `~~~` fences and fences with leading indentation.
- Round-trip property tests for tricky content.
