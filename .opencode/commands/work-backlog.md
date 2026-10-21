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
7. Stage the code changes: `git add -A`
8. Close the issue and commit everything together (code changes + comment + issue close) with a descriptive commit message referencing the issue number: `./gitrac commit <id> -c "comment text" -- -m "fix: summary (#<id>)"`. The comment documents what was done (like a PR description -- summarize the changes, what was fixed/added, files affected, and any notable decisions). If `git commit` fails (for example a hook rejects it), the issue stays open: fix the problem and run it again
9. Only then move on to the next issue

Run `./bun run check` before every commit. Never move on until fully satisfied with the current solution.
