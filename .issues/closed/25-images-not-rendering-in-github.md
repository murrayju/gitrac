---
id: 25
title: Images not rendering in GitHub
status: done
priority: medium
assignee: Justin Murray
labels:
  - bug
created: '2026-03-30T02:11:50.820Z'
createdBy: web
updated: '2026-03-30T02:20:49.361Z'
---

Embedded images do not render correctly in other markdown viewers, such as GitHub. This is because the URLs start with `/api`, rather than a normal repo path.

We need to use paths that work correctly in both places. This likely requires updating our router to support `/.issues/assets/` paths.

---

### Justin Murray — 2026-03-30T02:20:49.361Z

Fixed by changing the canonical image URL format from `/api/issues/assets/<filename>` to `/.issues/assets/<filename>`. This format works as a repo-root-relative path on GitHub while also being served by a new route in the web server. Updated the upload endpoint, asset reference extraction regex, and migrated all 12 existing issue files containing old-format URLs.
