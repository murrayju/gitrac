---
id: 24
title: Close and comment in one atomic CLI command
status: done
priority: medium
assignee: Justin Murray
labels:
  - enhancement
created: '2026-03-30T01:03:26.145Z'
createdBy: web
updated: '2026-03-30T01:42:38.764Z'
---

Add a `--comment "<text here>"` flag to the `gitrac close` command. This enables documenting why an action was taken, in the same command. The same should be done for `edit`, `reopen`, and `claim`.

---

### web — 2026-03-30T01:07:44.084Z

Should update the [AGENTS.md](http://AGENTS.md) and skills as needed to make use of this new capability.

### Justin Murray — 2026-03-30T01:42:38.764Z

Added --comment / -c flag to close, edit, reopen, and claim CLI commands, enabling inline comments with any action.

Changes:
- src/cli/commands/close.ts: Added -c/--comment option, author resolution, comment insertion before writeIssue()
- src/cli/commands/edit.ts: Added -c/--comment option with lazy author resolution (only when comment provided)
- src/cli/commands/reopen.ts: Added -c/--comment option, changed action to accept options, added author resolution
- src/cli/commands/claim.ts: Added -c/--comment option, reused existing author resolution
- AGENTS.md: Updated Working on Issues steps to show --comment flag usage
- skills/using-gitrac/SKILL.md: Updated Quick Reference table and workflow steps to document --comment flag

All commands now support: gitrac <command> <id> -c 'comment text'
