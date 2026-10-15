---
id: 49
title: Web amend rewrites the create commit message
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T00:34:27.163Z'
---

After creating an issue in the web UI, subsequent edits amend the create commit and replace its message with `update #N ...`, so history no longer shows the issue being created. Same for comment → update sequences.

## Acceptance criteria

- When amending, keep the first operation's message (or combine, e.g. `create #N title (+ edits)`).
- Test the message after create + update.

---

### Justin Murray — 2026-10-15T00:34:27.163Z

\## #49: Web amend no longer overwrites the create commit message

**What was wrong**
When the web UI amended the previous commit for the same issue, `AmendTracker.commitOrAmendLocked` passed the new operation's message straight to `git commit --amend`. So create → update ended up as a single `update #N …` commit, and history no longer showed that the issue was created. Comment → update had the same problem.

**What changed**
- `src/git/amend-tracker.ts`: new pure helper `amendedMessage(existing, incoming)` and an `AMEND_SUFFIX` constant (` (+ edits)`). Before amending, the tracker reads HEAD's message (`git log -1 --format=%B`) and builds the new one from it:
  - It keeps the first operation's subject, e.g. `gitrac: create #5 Fix login`.
  - It adds ` (+ edits)` once, when a folded-in operation has a different message. Later amends don't stack it.
  - If the incoming message is the same as the existing one, the message is left alone.
  - Any body lines are kept, and the suffix goes on the subject line.
  - If HEAD's message is empty or can't be read, the new message is used.
- No web route changes were needed. Reading HEAD also covers the create route, which commits directly and only calls `amendTracker.record(id, hash)`, so the tracker never sees its message.

**Tests**
- `src/git/amend-tracker.test.ts`:
  - Unit tests for `amendedMessage`.
  - Two existing `commitOrAmend` tests that expected the last operation's message now expect the first one plus the suffix.
  - New tests for amending after `record()`, and for identical messages getting no suffix.
- `src/web/routes/issues-amend.test.ts` (new): end-to-end through the routes against a real git repo:
  - create + PATCH gives `create #N title (+ edits)` as one commit.
  - create + update + comment still shows the create.
  - comment + update keeps the comment message.

  The new tests weren't run against the old code, but they assert on messages that the old code replaced with the last operation's message.
- `./bun run check` passes (645 tests).

**Docs**
- `docs/specs/2026-03-28-gitrac-design.md`: added step 5 to the web amend strategy describing how the message is kept.

**Decisions / trade-offs**
- The message keeps the first operation's title. If the title is renamed during an amend chain, the subject still shows the original title, e.g. `create #5 Old title (+ edits)`. This matches the "keep the first operation's message" criterion; showing the new title would mean parsing the free-form messages.
- I chose a generic ` (+ edits)` suffix over listing each operation type, because the routes pass free-form message strings and listing types would need an API change to every route. That would have touched the close/reopen routes #50 is working on.

**Follow-ups / interactions**
- The amended subject is based on whatever HEAD's message is, so it also depends on `config.git.commitPrefix`. If #48 makes the server reload config live, a prefix change in the middle of an amend chain keeps the old prefix until a new commit starts.
