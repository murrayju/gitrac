---
id: 51
title: CLI and web route logic is duplicated
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - chore
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T01:16:54.233Z'
---

Every CLI command and web route re-implements: find issue, read, mutate, compute old/new paths across `.issues/` and `closed/`, write, delete old file, collect paths, commit, push. The duplication is the root cause of several inconsistencies (reopen status, which files are committed, validation, author resolution).

## Acceptance criteria

- Introduce a service layer (e.g. `src/service/`) with operations like `createIssue`, `updateIssue`, `addComment`, `closeIssue`, `reopenIssue`, `claimIssue` that take a context (root dir, config, identity, commit options) and return the result + changed paths.
- CLI commands and web routes become thin adapters.
- Locking, validation and commit logic live in one place.

Best done after the critical bug fixes, and it will make subsequent features much simpler.

---

### Justin Murray — 2026-10-15T01:16:54.233Z

I've added the service layer, and the CLI commands and web routes now just call it. `./bun run check` passes: 709 tests, 671 existing plus 38 new ones in `src/service/`. No existing test was changed.

\## What was wrong
Each CLI command and web route had its own copy of the same steps: find the issue, read it, check it, change it, work out paths across `.issues/` and `closed/`, write, delete the old file, collect paths, commit, push. The copies had drifted apart, and locking, validation and commit logic were spread across every file.

\## What changed
**New `src/service/` layer** (between `git` and `cli`/`web`), one function per operation:
- **Issues** (`issues.ts`): `createIssue`, `updateIssue`, `addComment`, `editComment`, `deleteComment`, `closeIssue`, `reopenIssue`.
- **Claims** (`claim.ts`): `claimIssue`, `unclaimIssue`.
- **Config** (`config.ts`): `initProject`, `updateLabelColors`, `updateAssignees`.

Each takes an explicit context: root dir, identity, a config loader, `noCommit`/`push`, a commit strategy, an `onWritten` hook and a policy. It returns the issue (or config), the changed paths and the commit hash.

The following now exist in one place, in the service: the repo lock, field validation, the close/reopen and claim rules, label registration, file moves, the list of files to commit (including referenced assets) and commit messages.
- **Commit strategies** (`commit.ts`): the CLI makes plain commits. The web uses `amendStrategy(tracker)`: create records the commit, later edits go through `commitOrAmend`, config changes are plain commits.
- **`If-Match`**: checked by a `precondition` hook that the service runs on the issue it loads under the lock.
- **Errors** (`errors.ts`): `ValidationError` prints exactly like `invalidInput`, but keeps the list so the web can still reply `{error, errors}`. `IssueUnreadableError` keeps the CLI's old message and exit code and lets the web keep answering 404.

**Adapters.** `src/cli/service-context.ts` builds the CLI context (`resolveClaimUser` moved here) and `src/web/service-context.ts` builds the web one. The commands and the routes in `routes/issues.ts` and `routes/config.ts` now just parse input, call the service and format the result. `withMutationLock`, `commitAndMaybePush`, `shouldCommit` and `src/cli/validation.ts` were left unused and are removed. `resolveAuthor` moved from `routes/identity.ts` into the service.

**Docs.** I updated the architecture section and the conventions in `AGENTS.md`, and the Architecture and Concurrency sections of `docs/specs`. Nothing users can see changed, so `SKILL.md` is unchanged.

\## Decisions / trade-offs
- **Behavior check:** I ran the same set of about 45 CLI commands and about 40 HTTP requests against the original code (from `git archive HEAD`) and the new code. Output, exit codes, JSON, status codes, ETags, git log and the files left on disk were the same. That included the cases where a commit fails and where an issue file is malformed.
- **CLI and web differences are kept on purpose:** `SurfacePolicy` (`CLI_POLICY` / `WEB_POLICY`) has one switch per difference:
  - assets are only committed by the web;
  - field edits are committed as `edit #N` (CLI) vs `update #N` (web);
  - CLI edit always commits `config.yaml`;
  - web comment messages include the issue title;
  - for a bad reopen status, the CLI reports the status error first, the web reports the issue error (404/409) first.
- **The web still uses the `mutationLock` middleware.** The service's lock can be taken again by the same request, so they don't conflict. Keeping it means requests still run in arrival order, the issue sent back in the response is read while still locked, and a lock timeout still returns 503.
- **CLI output timing:** the CLI prints its result from `onWritten`, which runs before the commit, so the issue is still printed when the commit or push then fails.
- **One small difference:** web reopen now gets its status rules from the server's live config, which keeps the last good copy, instead of a separate `readConfig`. This only matters if `config.yaml` is unparseable during the request.

\## Problems noticed (not fixed)
- Commenting, and claiming an open issue, write the file under the name matching the current title but don't delete an older file with a different name, which leaves a duplicate.
- `edit` on a file with no frontmatter outputs `# #NaN: x`.
- Some CLI and web differences are worth unifying later: every `SurfacePolicy` switch, plus the web never pushing, CLI `-c` comments not being trimmed while web comments are, and `deleteComment` never committing assets.
- The claim/unclaim error messages mention `--force` and `gitrac reopen`, so a future web claim route would need neutral wording.
- `PATCH /api/config/*` with a non-JSON or `null` body returns 500.
- **Interactions with open issues:** #59 (delete command) should become a service operation; #57 and #56 will change validation and claim logic, which now live only in `src/service/`.
