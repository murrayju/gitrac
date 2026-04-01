---
id: 32
title: Pasted images should have a max size
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-04-01T17:31:51.220Z'
createdBy: web
updated: '2026-04-01T18:31:01.072Z'
---

Pasting very large images into issue descriptions and/or comments should not take over the whole screen. These should be constrained to some max width/height, and then have some controls to "zoom" (full-screen image viewer). Here's how this looks in Linear

![image.png](/.issues/assets/RFEMaJlN1CQPfvTgy5ZWi.png)Resize handles and hover actions (we want all of these):

![image.png](/.issues/assets/c_4k_ogb9gIG8JE2q2AoO.png)Full screen viewer

![image.png](/.issues/assets/ahF-N4ui6begAqIAIPmNZ.png)

---

### Justin Murray — 2026-04-01T18:31:01.072Z

Implemented image size constraints and fullscreen lightbox viewer. Images in .tiptap are now capped at 400px max-height with object-fit: contain. Clicking any image opens a fullscreen overlay with download and close buttons, Escape to dismiss. Uses event delegation in Layout for zero per-editor changes.
