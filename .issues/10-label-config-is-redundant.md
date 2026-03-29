---
id: 10
title: Label config is redundant
status: in_progress
priority: low
assignee: Justin Murray
labels:
  - enhancement
created: '2026-03-29T17:18:06.619Z'
createdBy: web
updated: '2026-03-29T18:09:55.787Z'
---

The config currently defines both a list of labels, and a map of colors.

```
labels:
  - bug
  - feature
  - enhancement
  - docs
  - chore
  - foo
labelColors:
  bug: '#e05d5d'
  feature: '#58a6e0'
  enhancement: '#4dba6f'
  docs: '#d4a843'
  chore: '#b065d6'
  foo: '#e07843'
```

This is redundant. The map has everything we need. Get rid of the array, and rename `labelColors` to just `labels`.
