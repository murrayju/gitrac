---
description: Work through the issue backlog, fixing issues one at a time
---

Work through the open issue backlog for this project. Run `./gitrac ls` to list open issues.

Process issues in ascending ID order. $ARGUMENTS

For each issue:

1. Read the full details: `./gitrac show <id>`
2. Claim it: `./gitrac claim <id>`
3. Explore the relevant code to understand the problem thoroughly
4. Dispatch a subagent to implement the fix/feature
5. Review the subagent's work -- check code quality, verify all checks pass with `./bun run check`
6. If not satisfied, iterate until the solution is correct
7. Add a comment to the issue documenting what was done (like a PR description -- summarize the changes, what was fixed/added, files affected, and any notable decisions): `./gitrac comment <id> -b "comment text"`
8. Close the issue: `./gitrac close <id> --no-commit`
9. Commit everything together (code changes + comment + issue close) with a descriptive commit message referencing the issue number
10. Only then move on to the next issue

Run `./bun run check` before every commit. Never move on until fully satisfied with the current solution.
