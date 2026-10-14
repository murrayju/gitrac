---
id: 36
title: Horizontal rule in description silently truncates content
status: done
priority: urgent
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T22:21:21.305Z'
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

---

### Justin Murray — 2026-10-14T22:21:21.305Z

\## Fix #36: a horizontal rule in a description no longer truncates the issue

\### What was wrong
`splitContent` treated the first `---` line after the frontmatter as the separator between description and comments. `parseComments` then threw away everything before the first `### author — timestamp` header. So any horizontal rule in a description cut it off there, and the next save wrote the shortened version to disk. Tiptap writes `---` for horizontal rules, so this was easy to hit from the web UI. Two related problems:
- Fence detection only knew about ```` ``` ````. It didn't handle `~~~` fences, fences with leading indentation, or matching a closing fence to its opener.
- Comment bodies could still corrupt themselves:
  - A `### X — Y` line inside a code fence wasn't escaped, so on parse it started a new comment.
  - Unescaping lost information: a body that really contained `\## x` came back as `## x`.

\### What changed
- **Separator rule:** a `---` line counts as the separator only if it is outside a code fence and the next non-blank line is a comment header. Any other `---`, `***` or `___` stays in the description. The comments section therefore always starts with a header, so nothing between the separator and the first comment can be dropped.
- **Description escaping:** one ambiguous case remained: a description with a rule followed by a line that looks like a comment header. When writing, only that line (outside fences) gets a `\` prefix. All other description content is written exactly as before, so the file format is unchanged.
- **Reversible escaping:** a line that already starts with backslashes gets one more when written, and exactly one is removed when read. This applies to description lines and comment bodies, so content round-trips for any input.
- **Comment bodies:** outside fences, headings are escaped as before. Inside fences, only lines that look like a comment header are escaped, so a fenced example can't split a comment.
- **Fence detection:** new shared helper `src/core/fences.ts`, used for both splitting and escaping. It handles ```` ``` ```` and `~~~` fences of 3 or more characters, any indentation (so fences inside list items work), no backticks in a backtick fence's info string, and a closing fence must use the same character and be at least as long as the opener.
- **Unclosed fence:** if a description ends inside an open fence and the issue has comments, a closing fence is appended when saving. Otherwise the fence would hide the separator and every comment.

\### Files
- `src/core/fences.ts`, `src/core/fences.test.ts` (new)
- `src/core/issue.ts`: separator detection, description escaping, closing an unclosed fence
- `src/core/comments.ts`: shared header regex and helpers, escaping inside fences, reversible backslash escaping
- `src/core/issue.test.ts`, `src/core/comments.test.ts`: regression tests, a seeded property test (3000 random documents built from tricky fragments, checking that saving and re-reading changes nothing), and a test that parses and re-writes every file in `.issues/` and `.issues/closed/` and checks the output is byte-for-byte identical
- `docs/specs/2026-03-28-gitrac-design.md`, `skills/using-gitrac/SKILL.md`: parsing rules updated

\### Decisions and trade-offs
- **Splitting checks fences:** a fenced example like `---` followed by `### a — b` stays in the description. Files written by the old code that contain such examples still parse the same way.
- **Unclosed fence gets closed:** the extra closing line is the only change made to content when saving, and only when an unclosed fence would otherwise swallow the comments.
- **Hand-edited files:** if text sits between a `---` and the first header, the parser now keeps it in the description instead of deleting it.
- **Compatibility check:** I compared parse results for every existing repo issue file before and after the change. They are identical, and all files still re-save byte-for-byte.
- **Tests:** the new tests fail against the original code (13 failures) and pass now. `./bun run check` passes (296 tests).

\### Follow-ups noticed (not fixed)
- The description is `.trim()`med, and the comments section and comment bodies lose leading and trailing whitespace. So leading indentation on the first line and trailing whitespace on the last line still aren't preserved. This is an older whitespace normalization, not data loss.
- `parseComments` still drops anything before the first header when called directly. Its only caller, `parseIssue`, can no longer pass it such input.
- `\r\n` line endings aren't handled: the `\r` ends up in comment timestamps. This was already the case before.
