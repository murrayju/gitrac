---
id: 72
title: Add a comprehensive README.md
status: done
priority: high
assignee: justin@tigerdata.com
labels:
  - docs
created: '2026-10-15T15:55:34.594Z'
createdBy: Justin Murray
updated: '2026-10-15T16:06:07.435Z'
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

---

### Justin Murray — 2026-10-15T16:06:07.435Z

Added `README.md` covering:
- motivation (comparison with hosted trackers)
- installation: release binaries and from source
- quick start
- how it works: file layout and format, git integration (path-limited auto-commits, atomic `--no-commit` closes, web amend, shared lock, collision-free IDs, merge driver), architecture
- the web UI, with screenshots
- CLI reference with the output contract and exit codes
- a full section on orchestrating coding agents: skill install, single-agent loop, dependencies/`ready`/`next --claim`, parallel agents in worktrees with real example output, releasing stuck claims, handling failures by exit code
- configuration and development

Screenshots of a demo repo are in `docs/images/` (list, detail, dependencies + claimed-elsewhere). Added the missing `LICENSE` (MIT, matching `package.json`).

A fresh subagent fact-checked the README against the code and its findings were applied. Code-level problems it uncovered were filed as separate issues: hard-coded `--version`, `init` not gitignoring drafts, the title prompt on stdout, `init` assuming `main`, and unknown frontmatter keys being dropped.
