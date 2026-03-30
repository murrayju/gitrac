---
id: 23
title: Manage whitespace after attached images
status: done
priority: low
assignee: Justin Murray
labels:
  - bug
created: '2026-03-30T00:46:45.111Z'
createdBy: web
updated: '2026-03-30T01:38:09.415Z'
---

We always render attached images on their own line. But the resulting markdown file will have no whitespace between the image the the following text, unless the user enters an additional newline.

Example: editor looks like this

![image.png](/.issues/assets/Npdi-e0xQ5kocRgv8Mw1b.png)And the file looks like this

![image.png](/.issues/assets/Xhaw8jAamH3QZn7WD3BvO.png)

I'm concerned that this might not render well in some markdown viewers. The whitespace in the file should better reflect what the user sees in the editor.

---

### Justin Murray — 2026-03-30T01:37:15.566Z

Fixed by creating a shared `getEditorMarkdown()` utility in `src/web/ui/lib/markdown.ts` that post-processes the tiptap-markdown output to ensure blank lines around block-level images. The `normalizeImageWhitespace()` function handles: adding blank lines before/after standalone image lines, preserving existing blank lines, and collapsing triple+ newlines. Updated all 3 call sites (IssueEditor, CommentEditor, CommentList) to use the shared utility, eliminating duplicated biome-ignore comments. Added comprehensive tests.

### Justin Murray — 2026-03-30T01:38:05.385Z

Fixed block image whitespace in markdown output by adding post-processing to the Tiptap markdown serialization.

Root cause: tiptap-markdown uses prosemirror-markdown's default image serializer which treats images as inline, not calling closeBlock(). This means block images (inline: false) don't get blank lines around them in the output.

Fix:
- Created src/web/ui/lib/markdown.ts with getEditorMarkdown() and normalizeImageWhitespace() — post-processes markdown to ensure blank lines before/after standalone image lines
- Created src/web/ui/lib/markdown.test.ts with 7 tests (before/after blank lines, existing spacing preserved, multiple images, start/end of content, no triple-spacing)
- Updated IssueEditor.tsx, CommentEditor.tsx, and CommentList.tsx to use the shared getEditorMarkdown() utility instead of raw tiptap-markdown storage access

Files affected: src/web/ui/lib/markdown.ts (new), src/web/ui/lib/markdown.test.ts (new), src/web/ui/components/IssueEditor.tsx, src/web/ui/components/CommentEditor.tsx, src/web/ui/components/CommentList.tsx
