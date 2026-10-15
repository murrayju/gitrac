---
id: 72
title: Add a comprehensive README.md
status: in_progress
priority: high
assignee: justin@tigerdata.com
labels:
  - docs
created: '2026-10-15T15:55:34.594Z'
createdBy: Justin Murray
updated: '2026-10-15T15:55:35.465Z'
---

The project has no README. Add one covering:

- Motivation: why keep issues as markdown in the repo
- Installation: release binaries and from source
- Quick start
- How it works: file format, config, git integration, IDs, merge driver, web UI
- CLI reference overview, including structured output and exit codes
- Using gitrac for agent orchestration: single agent, parallel agents in worktrees, dependencies/`ready`/`next --claim`, releasing stuck claims, merging
- Development pointers (AGENTS.md)
- License

Include screenshots of the web UI.
