---
id: 85
title: serve --port with a non-numeric value reports NaN
status: todo
priority: low
assignee: ''
labels:
  - bug
created: '2026-10-15T16:07:08.274Z'
createdBy: Justin Murray
updated: '2026-10-15T16:07:08.274Z'
---

`gitrac serve --port abc` prints `Invalid port "NaN"`. The error should echo the original input and use the standard `invalid_input` error (exit 2). The same applies to `--port 99999` and other out-of-range values.
