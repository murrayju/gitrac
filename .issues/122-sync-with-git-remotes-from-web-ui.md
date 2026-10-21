---
id: 122
title: sync with git remotes from web ui
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-21T20:32:29.596Z'
createdBy: Justin Murray
updated: '2026-10-21T20:47:23.483Z'
---

The web UI should show an indication of how far ahead/behind the current repo is from the configured remote(s). It should also have an interface to trigger a sync.

This is important because it may not be obvious to a user of the web app that their local changes are not being synced.

Handling multiple remotes is tricky. The primary interface should be simple, with a simple sync button that does the necessary pull/push. For advanced use cases, we will need a view that lists all remotes, allows for push/pull/sync operations that target a single remote, and enables/disables remotes to include in the default/simple sync.

When a pull/push is not possible due to conflicts, the UI should go into a very apparent error state, and direct the user to resolve the conflicts manually (in their terminal).

We should also visualize a summary of *which* commits would be synced (in a tooltip).
