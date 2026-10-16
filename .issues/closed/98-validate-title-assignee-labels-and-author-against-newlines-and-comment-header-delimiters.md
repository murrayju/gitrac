---
id: 98
title: >-
  Validate title, assignee, labels, and author against newlines and
  comment-header delimiters
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T12:12:44.936Z'
createdBy: Justin Murray
updated: '2026-10-16T19:57:32.671Z'
---

`validateIssueFields` (`src/core/validate.ts`) and `resolveAuthor` (`src/service/context.ts`) only check `typeof === 'string'` and `.trim()`, allowing `\r` and `\n` in `title`, `assignee`, `labels`, and `author`, as well as ` — ` (`\u2014`) in `author`:

- If `--author` (or `author` in `POST /api/issues/:id/comments`) contains a newline, `serializeComments` writes a multi-line `### ...` header that fails `COMMENT_HEADER_RE` on read-back; if it is the first comment on the issue, `findSeparator` fails and the comment is silently absorbed into `description`.
- If `author` contains ` — ` followed by text, `COMMENT_HEADER_RE` (`/^### (.+?) \u2014 (.+)$/`) splits the author name at the first ` — ` and corrupts `author` and `timestamp` on read-back.
- If `title`, `assignee`, or `labels` contain newlines, it breaks `gitrac ls` table formatting and injects extra lines into auto-generated git commit subjects.

## Acceptance criteria

- Reject `\r` and `\n` in `title`, `assignee`, `labels`, and `author` with `invalid_input` (CLI exit 2, HTTP 400).
- Reject ` — ` (`\u2014`) in `author` (or ensure comment headers round-trip unambiguous author names) so a comment can never fail to parse its header on read-back.
- Add unit, service, CLI, and web validation tests.

---

### Justin Murray — 2026-10-16T19:57:32.262Z

\## Summary

\### What was wrong
- `validateIssueFields` (`src/core/validate.ts`) only checked that `title`, `assignee` and `labels` were strings, so they could contain `\r` or `\n`. That broke the `gitrac ls` table and put extra lines into generated commit subjects.
- `resolveAuthor` (`src/service/context.ts`) only checked that an explicit author was a non-empty string. The places that use `(await ctx.identity()).name` as a comment author checked nothing. That allowed two kinds of damage to comment headers (`### {author} \u2014 {timestamp}`):
  - **Newline in the author:** the header spans several lines and fails `COMMENT_HEADER_RE` on read-back. If it was the first comment, the comment was silently merged into the description.
  - **` — ` in the author:** the header regex splits at the first em dash, so `author` and `timestamp` come back wrong.

\### What changed
- **`src/core/validate.ts`**
  - `validateIssueFields` now rejects a line break in `title`, `assignee` or any label, with messages like `Invalid title: must not contain line breaks`. The check runs after trimming, so a stray trailing newline is still trimmed away, as before.
  - New pure helpers that hold the rule in one place:
    - `hasLineBreak`
    - `INVALID_AUTHOR` (moved here from the service layer)
    - `authorError(name)`, which rejects a non-string or blank name, `\r`/`\n` and U+2014.
- **`src/service/context.ts`**
  - `resolveAuthor` now throws instead of returning `null`. It takes an optional error factory, so `createIssue` still throws a `ValidationError` (keeping the HTTP 400 `{ error, errors }` shape).
  - New `identityName(ctx)` checks the identity's name before it is used as an author.
- **`src/service/issues.ts`**
  - The `-c/--comment` author for `updateIssue`, `closeIssue` and `reopenIssue` is now worked out and checked before the issue is loaded, so input errors still come first.
  - `appendComment` became a sync function that is passed the author.
- **`src/service/claim.ts` and `src/service/ready.ts`**
  - New `assertValidUser` runs before the lock in claim, unclaim and next `--claim`.
  - With a non-blank comment, the name must be a valid author.
  - A claim also rejects a line break in the name or email, because that value becomes the assignee and goes into `config.assignees`.
- **`src/service/renumber.ts`:** the renumber comment author is checked first, before anything is read or an ID is allocated.
- **Docs:** I updated the write-validation, comment-format and Identity sections of `docs/specs/2026-03-28-gitrac-design.md`, and the validation note in `skills/using-gitrac/SKILL.md`.
- How existing files are parsed is unchanged.

\### Tests
- **`src/core/validate.test.ts`:** line-break rejections and their messages, trim-then-check behavior, and `authorError` / `hasLineBreak` cases.
- **`src/service/issues.test.ts`:**
  - create and update reject bad fields and write nothing.
  - A bad explicit author is rejected for create and addComment, before the issue lookup.
  - A bad identity name is rejected for comment, `-c` on update and close, and reopen.
  - An update without a comment still works with that identity.
  - A valid author round-trips through the comment header.
- **Claim and renumber:** `src/service/claim.test.ts`, `ready.test.ts` and `renumber.test.ts` cover the identity checks for claim/unclaim comments, the claim assignee, `claimNextIssue` and the renumber comment.
- **`src/cli/validation.test.ts`:**
  - create and edit reject line breaks.
  - `--author` with a newline or em dash fails `create`, `comment`, `close --comment` and `claim --comment` with exit 2 and changes no files and no `HEAD`.
  - `-o json` reports `invalid_input`.
- **`src/web/routes/issues-validation.test.ts`:**
  - `POST`/`PATCH /api/issues` return 400 for line breaks.
  - A bad `author` on `POST /api/issues` and on the comments route returns 400 and writes nothing.
- **Results:**
  - With the source changes stashed, 32 of the new tests fail.
  - With the changes, `src/core`, `src/service`, `src/cli` and `src/web` all pass (1291 tests).
  - `typecheck` and `lint` are clean (0 warnings, 0 errors).

\### Decisions and trade-offs
- **Reject, don't escape:** I chose to reject bad author names rather than escape them in headers. That keeps the file format and parser unchanged and needs no migration.
- **Identity checked only when written:** the identity's name is checked only when it will actually be written as an author or assignee. A git `user.name` with an em dash can still edit, close or claim without a comment. It fails only when it would produce an unparseable header.
- **Error ordering:** for `-c` comments the identity is now resolved before the issue is loaded, so a bad identity is reported ahead of not-found or state errors, matching how input errors are ordered elsewhere.

\### Follow-ups noticed
- `PATCH /api/config/assignees` (`updateAssignees`) does not reject line breaks or em dashes in `name`/`email`. The web "Acting as" picker can still send such a name, which `addComment` now rejects with a 400 when it is used.
- `--author` on `serve` (`IdentityResolver`) is not checked at startup. A bad value only fails on each write.
- `validateIssue` (the final check on an assembled issue) does not check `createdBy` or comment authors read from disk.
