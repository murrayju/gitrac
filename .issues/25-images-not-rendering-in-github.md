---
id: 25
title: Images not rendering in GitHub
status: in_progress
priority: medium
assignee: Justin Murray
labels:
  - bug
created: '2026-03-30T02:11:50.820Z'
createdBy: web
updated: '2026-03-30T02:18:35.011Z'
---

Embedded images do not render correctly in other markdown viewers, such as GitHub. This is because the URLs start with `/api`, rather than a normal repo path.

We need to use paths that work correctly in both places. This likely requires updating our router to support `/.issues/assets/` paths.
