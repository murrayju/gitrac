---
id: 1
title: light mode toggle is buggy
status: backlog
priority: medium
assignee: ''
labels:
  - bug
created: '2026-03-29T05:00:18.040Z'
createdBy: web
updated: '2026-03-29T05:06:39.397Z'
---

The light mode toggle only appears to affect the background of the main panel, and the font color. The left sidebar background remains dark (but the text becomes unreadable). The inputs on the main panel also remain dark.

We need to ensure there are no hardcoded colors in components, and always use theme variables.
