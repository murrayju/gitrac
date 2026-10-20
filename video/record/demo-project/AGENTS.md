# notes

Issues are tracked with gitrac in `.issues/`.

To work through the backlog, repeat until `gitrac next --claim` exits 5:

1. `gitrac next --claim` to take the top ready issue.
2. Fix it and add a test. Run `npm test` and make sure it passes.
3. `gitrac close <id> --no-commit -c "<one-line summary>"`
4. `git add -A && git commit -m "<type>: <summary of this fix> (#<id>)"`

Do one issue at a time, with one commit per issue. Close an issue only after
`npm test` passes. Keep each change small. Do not ask for confirmation.
