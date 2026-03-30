---
id: 8
title: Routing problem
status: done
priority: high
assignee: Justin Murray
labels:
  - bug
created: '2026-03-29T17:12:39.898Z'
createdBy: web
updated: '2026-03-29T18:04:52.909Z'
---

When navigating through the site pages, the URL (correctly) updates with a proper url for each view. However, directly visiting such a link (or reloading the page when already looking at one) does not work. It loads a mostly empty page with what looks like a tostringed object.

![image.png](/.issues/assets/X6SQsQHFqI3UWoweQ1mcT.png)The backend router needs to agree with the frontend router.
