---
id: 113
title: Web "Mine" filter should follow the Acting as identity
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-16T21:58:40.487Z'
createdBy: Justin Murray
updated: '2026-10-17T13:28:29.019Z'
---

Found by #104. The list's "Mine" checkbox sends `mine=1`, which the server resolves to its own git identity, not the identity picked in the sidebar's "Acting as" picker.

## Acceptance criteria

- `GET /api/issues` accepts an explicit identity for `mine` (e.g. `mine=<configured assignee name>`, validated against `config.assignees`), and the UI sends the acting identity.
- Tests.

---

### Justin Murray — 2026-10-17T13:28:28.628Z

The "Mine" checkbox in the web list now filters by the identity picked in "Acting as", not the server's git identity. Typecheck, lint (0 warnings, 0 errors), all `src/web` tests (442) and the Vite build pass. With the fix removed, the 3 new tests that cover it fail.

\## What was wrong
The "Mine" checkbox sent only `mine=1`. `GET /api/issues` resolved that to the server's git identity. So picking another user in the sidebar's "Acting as" picker did not change which issues "Mine" showed. Claim, comment and create already used the acting identity.

\## What changed
- **API** (`src/web/routes/issues.ts`): `GET /api/issues` takes an optional `author=<name>` next to `mine`.
  - `mine` is still a plain on/off flag, and `mine=1` alone works as before.
  - With `mine=1&author=<name>`, the name goes through the existing `actingIdentity` resolver from `src/web/service-context.ts`. That is the same rule as `author` on claim: a configured assignee gives their name + email, the server's own name gives the server identity, and anything else is **400**.
  - The new helper `mineIdentity` picks between that resolver and `serverIdentity`.
- **UI query** (`src/web/ui/api.ts`, `src/web/ui/lib/list-filters.ts`): `IssueFilters` has a new `author` field. `ListFilterState` has a new `actingAuthor` field. `issueListQuery` sends `author` only together with `mine`.
- **`IssueList.tsx`** (small change): it works out `actingAuthor` with `effectiveAuthor(useIdentityStore author, useServerIdentity name, config.assignees)`, which is left out when it is the server identity. The tooltip now says "Only issues assigned to you (the "Acting as" identity)".
- **Spec** (`docs/specs/2026-03-28-gitrac-design.md`): the `/api/issues` row documents `author` with `mine`, and the List View text now says "Mine" follows "Acting as".

\## Tests
- `src/web/routes/issues.test.ts`, new `mine with author` group:
  - A configured assignee's issues match by name or email; padding around the name is trimmed.
  - The server's own name and `mine=1` alone both give the server identity.
  - Unknown, blank and email-instead-of-name authors give 400.
  - `author` without `mine` (or with `mine=0`) is ignored.
- `src/web/ui/lib/list-filters.test.ts`:
  - With "Mine" checked, the acting author is sent as `author`; it is left out for the server identity.
  - `author` is never sent without `mine`.
- The two "author is ignored without `mine`" tests also passed before the fix, because the old code ignored `author` anyway. They guard the chosen behavior.

\## Decisions / trade-offs
- **`author` without `mine` is ignored, not rejected.** That matches how the other filters are optional, and the spec documents it.
- **Name only, no email.** `author` must be a name, the same as on writes. An email gives 400.
- **The server identity is never sent.** The UI leaves `author` out for it, so the default request is unchanged and is the same as `gitrac ls --mine` run by the server.
- **No `SKILL.md` change.** CLI and agent behavior did not change, and the skill does not document the API query parameters.

\## Follow-ups noticed
- While the server identity is still loading, `effectiveAuthor` can send a picked name that turns out to be the server's own name. The server resolves that to the same identity, so the results are the same.
- `src/web/ui/api-links.test.ts` only covers `mine` with the server identity. An end-to-end `fetchIssues({ mine: true, author })` case could be added there.

**Orchestrator note:** moved the `isTruthy` doc comment back above `isTruthy` (the new `mineIdentity` helper had been inserted between them).
