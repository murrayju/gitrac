---
id: 7
title: Updating closed issue should not create duplicate
status: done
priority: high
assignee: Justin Murray
labels:
  - bug
created: '2026-03-29T17:09:25.658Z'
createdBy: web
updated: '2026-03-29T17:58:56.435Z'
---

Editing a closed issue (adding a label) should not create a duplicate issue.

![image.png](/.issues/assets/hoFFUT5a4ZOaDkrRafyOH.png)

It seems to have created a copy in `.issues`, when it already existed in `.issues/closed`. All issues with a closed status should remain in the closed folder.

Additionally, there is a filtering bug, where the default "All statuses" filter only shows one of the two duplicates (the one not in the closed folder).
