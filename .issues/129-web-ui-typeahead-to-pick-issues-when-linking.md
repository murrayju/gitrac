---
id: 129
title: 'Web UI: typeahead to pick issues when linking'
status: backlog
priority: medium
assignee: ''
labels:
  - enhancement
links:
  - type: issue
    relationship: related
    id: 127
created: '2026-11-02T15:52:55.357Z'
createdBy: Justin Murray
updated: '2026-11-02T15:52:56.479Z'
---

Linking issues in the web UI means typing a bare issue number (`#12`) into the "Link issue" input of the links panel, and the status prompt for "Duplicate of". You have to know the number.

Replace these inputs with a typeahead:

- Search issues by ID and by title words as you type (open and closed; the same matching as the list's search).
- Show each match as `#ID title` with its status badge; keyboard navigation (up/down, Enter, Escape).
- Leave out the issue itself, and issues that already have the chosen relationship to it.
- Still accept a typed number, including several for the relationships that take a list.
- Use it everywhere an issue number is entered: the links panel and the "Duplicate of" prompt.
