---
id: 114
title: gitrac serve should avoid port conflicts
status: todo
priority: medium
assignee: ''
labels: []
created: '2026-10-20T20:36:22.631Z'
createdBy: Justin Murray
updated: '2026-10-20T20:36:22.631Z'
---

It seems that it always chooses port 3000 by default, even if another process has that port bound already. It should find an available port automatically (unless the --port flag is used)
