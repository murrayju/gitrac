---
id: 21
title: 'Issue drafts, modal close confirmation'
status: in_progress
priority: medium
assignee: Justin Murray
labels:
  - feature
created: '2026-03-30T00:34:48.918Z'
createdBy: web
updated: '2026-03-30T01:20:41.011Z'
---

Currently, when filling out the new issue modal, if you close it (whether accidental or intentional), all your progress is lost. Instead, (debounced) edits should be implicitly persisted in a drafts folder (use a timestamp for the filename). This way, even if you hard-reload the tab, it'll survive.

Closing the modal should show a confirmation like Linear's

![image.png](/api/issues/assets/jYJBTsc6v6WJFaLI5MT8m.png)Choosing `Discard` will delete from the drafts folder.

When drafts are present, show a link to a drafts page in the sidebar

![image.png](/api/issues/assets/-xwBkn7x2wrya8gNUexWC.png)This page should list the drafts similar to the issues list. Clicking on one should reopen the modal, with the previous content loaded.
