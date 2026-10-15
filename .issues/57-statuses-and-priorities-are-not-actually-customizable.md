---
id: 57
title: Statuses and priorities are not actually customizable
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T03:48:21.232Z'
---

The spec says statuses/labels/priorities in `config.yaml` are the source of truth and user-customizable, but `Status`/`Priority` are hard-coded unions, `validateConfig` rejects anything outside the built-in sets, closed statuses are hard-coded to `done`/`cancelled`, and sort orders are hard-coded.

Either make them genuinely configurable (status definitions with a `closed: boolean` flag and order; priority order from config) or update the spec/docs to say they're fixed.
