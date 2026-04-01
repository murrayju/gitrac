---
id: 27
title: Store assignees in the config.yml
status: done
priority: none
assignee: Justin Murray
labels:
  - enhancement
created: '2026-03-30T23:56:17.966Z'
createdBy: web
updated: '2026-04-01T17:54:19.404Z'
---

This should be a list of users, each with a name and email. This is used to populate the assignee selector. New users can be added from the ui picker, or implicitly when specified in the CLI. Only the email should be stored in the metadata on a ticket, and the UI can render the name (with email shown in a tooltip).

---

### Justin Murray — 2026-04-01T17:54:19.404Z

Implemented assignees in config.yml: added Assignee type, config parsing/validation/serialization with backward compat, PATCH /config/assignees API route, AssigneePicker UI component (with create-new-assignee flow), updated MetadataPanel/CreateIssueModal/IssueRow/IssueList to resolve names from config, and updated CLI claim to use email as canonical identifier and auto-add to config.assignees.
