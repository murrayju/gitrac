---
id: 14
title: Creating issue from modal should navigate to new issue
status: done
priority: medium
assignee: Justin Murray
labels:
  - enhancement
  - bug
created: '2026-03-29T17:32:44.433Z'
createdBy: web
updated: '2026-03-29T18:39:52.412Z'
---

When submitting a new issue from the modal, it should immediately navigate to the new issue (rather than return to the previous view).

---

### web — 2026-03-29T17:35:29.636Z

Actually, upon further inspection, this seems to be partially implemented but buggy. Submitting does go to the new route, and the title updates, but the issue description remains from the prior view.

![image.png](/.issues/assets/kTMoYR7M2qNpuIGlrOSeq.png)(see the title from #14, with the description from #13)

We may need to use `key` on react components to force rerendering, or something.
