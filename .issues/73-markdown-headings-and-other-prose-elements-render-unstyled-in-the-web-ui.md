---
id: 73
title: Markdown headings and other prose elements render unstyled in the web UI
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T16:06:57.530Z'
createdBy: Justin Murray
updated: '2026-10-15T16:07:27.683Z'
---

Found while taking README screenshots. The editor/markdown views use Tailwind `prose` classes, but headings render like body text (`h2` computes to 16px, the same as `p`). `## Steps to reproduce` in a description looks like a plain paragraph. Likely cause: the `@tailwindcss/typography` plugin isn't installed or enabled for Tailwind v4, so `prose` has only partial custom rules.

## Acceptance criteria

- Headings (h1–h4), lists, blockquotes, code blocks, tables and horizontal rules are styled consistently in the editor, read-only markdown and comments, in both dark and light mode.
- Use `@tailwindcss/typography` (Tailwind v4 `@plugin`) or equivalent CSS. Keep the existing image sizing/lightbox styles working.
- UI build passes. The orchestrator will verify visually and refresh `docs/images/issue-detail.png`.
