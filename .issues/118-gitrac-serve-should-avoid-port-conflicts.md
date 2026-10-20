---
id: 118
title: gitrac serve should avoid port conflicts
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-20T20:36:22.631Z'
createdBy: Justin Murray
updated: '2026-10-20T21:47:23.844Z'
---

It seems that it always chooses port 3000 by default, even if another process has that port bound already. It should find an available port automatically (unless the --port flag is used)

---

### Justin Murray — 2026-10-20T21:14:04.542Z

Renumbered from #114 (duplicate ID).
