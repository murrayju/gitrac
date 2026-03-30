---
id: 18
title: Improve skill
status: in_progress
priority: medium
assignee: Justin Murray
labels:
  - enhancement
created: '2026-03-30T00:07:22.938Z'
createdBy: web
updated: '2026-03-30T01:07:37.094Z'
---

Improve the `using-gitrac` skill to add instructions that a comment should always be added to the ticket when closing. This should include a summary of the changes implemented, the same content that would go into a PR description.

---

### Justin Murray — 2026-03-30T01:07:37.094Z

Updated the using-gitrac skill (skills/using-gitrac/SKILL.md) and AGENTS.md to include a mandatory comment step before closing issues.

Changes:
- Added step 4 'Document what was done' to the skill workflow, between implementing and closing. This instructs users to always add a comment summarizing changes (like a PR description) before closing.
- Renumbered steps 4->5 (Close) and 5->6 (Verify) accordingly.
- Added 'Closing without a comment' to the Common Mistakes table.
- Updated AGENTS.md 'Working on Issues' section to include the comment step, the --no-commit pattern, and committing everything together.
- Fixed incorrect -b flag in comment examples (the CLI uses a positional argument, not a flag).

Files affected: skills/using-gitrac/SKILL.md, AGENTS.md
