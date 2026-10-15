---
id: 47
title: Web UI attributes all comments and issues to "web"
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T00:00:52.891Z'
---

The web server hard-codes `createdBy: 'web'` and defaults comment `author` to `'web'`; the UI never sends an author. Issue history loses who did what.

## Acceptance criteria

- Server resolves the default identity from `git config user.name`/`user.email` at startup (refresh when config changes), and uses it for `createdBy` and comment authors.
- Optionally allow choosing an identity from `config.assignees` in the UI.

---

### Justin Murray — 2026-10-15T00:00:52.891Z

\## #47: Web changes now use the git identity instead of "web"

**What was wrong**
`POST /api/issues` always wrote `createdBy: 'web'`. Comments posted without an `author` (the UI never sent one) also got `'web'`. So issue history didn't show who did what.

**What changed**
- **New `src/git/identity.ts`**
  - `readGitIdentity(dir)` reads `git config user.name` / `user.email` as seen from the project root, so a repo-local config wins over the global one. If nothing is set it falls back to `unknown` / `''`, like the CLI.
  - `IdentityResolver` remembers the identity and reads git config again at most every 5 seconds. A `git config user.name …` change shows up without restarting the server. If several requests ask at once, git is only queried once. `--author` pins a fixed name, like `resolveClaimUser` in the CLI.
- **Server (`src/web/server.ts`)**
  - `ServerContext` has a new optional field, `identity`. `startServer` fills it in at startup, before handling requests, and prints `Attributing web changes to Name <email>`.
  - If a context is built without it (tests), it is created from `ctx.dir` the first time it's needed, so existing test setups didn't have to change.
  - `startServer` takes a new `author` option. `serve.ts` passes the global `--author` into it.
- **Routes**
  - New `src/web/routes/identity.ts`:
    - `GET /api/identity` returns the default `{ name, email }`.
    - `resolveAuthor()` uses an explicit `author` from the request if there is one; otherwise it uses the server's name.
  - In `issues.ts`:
    - `createdBy` and the default comment author now come from this, as display names, the same as the CLI.
    - `POST /api/issues` now also accepts an optional `author`. An invalid value gets a 400, checked before an ID is allocated.
  - Assignee behaviour is unchanged.
- **UI (the optional criterion)**
  - A new "Acting as" picker in the sidebar (`IdentityPicker.tsx`). It offers the git identity plus the names in `config.assignees`, and remembers the choice in `localStorage`.
  - `CommentEditor` and `CreateIssueModal` send the chosen name as `author`.
  - If the saved name is no longer a configured assignee, the picker clears it.
  - Supporting files: `stores/identityStore.ts` and `lib/identity.ts`.
- **Docs:** `docs/specs` has a new Identity paragraph, the API table now lists `/api/identity` and the `author` fields, and the `--author` row was updated. One line was added to `skills/using-gitrac/SKILL.md`.

**Tests** (`./bun run check` passes: 563 tests, typecheck and lint)
- `src/git/identity.test.ts`: reading from repo config, the fallback, the 5-second cache and re-read, the single shared lookup, and the `--author` override.
- `src/web/routes/identity.test.ts`: uses a real git repo to check the endpoint and that `createdBy` and comment authors come from git. Also checks that a `git config` change is picked up without a restart, and the `--author` override.
- `issues.test.ts`: the old "defaults author to web" test now expects the git identity. New tests cover an explicit `author`, and that an invalid `author` (blank, a number or `null`) gets a 400 with no ID used up.
- `src/web/ui/lib/identity.test.ts` and a `--author` case in `global-options.test.ts`.

I also started the server in a scratch repo and checked that `/api/identity` and `createdBy` reflect the git config.

**Decisions and trade-offs**
- **Re-reading every 5 seconds instead of watching git's config files:** a lookup costs two `git config` calls. Watching files would have to cover global, XDG and included config files, which is fragile. The cost is that a config change can take up to 5 seconds to appear.
- **Any `author` name is accepted, not just configured assignees:** the comment endpoint already worked this way, and the server has no authentication anyway. Only the UI limits the choice to assignees.
- **The picker fetches `/api/config` itself (on mount and when the window regains focus) instead of using `useConfig`.** Each `useConfig`/`useSSE` call opens its own `EventSource`, and I didn't want to add another one.

**Follow-ups noticed**
- `useConfig()` is called in every `IssueRow` and each call opens its own SSE connection. With many rows this can hit the browser's limit of about 6 connections per host over HTTP/1.1. That's relevant to #61 (`hooks.ts`), which I didn't touch.
- `ServerContext` and `server.ts` are shared with #61. My edits there are small additions: one import, one field, one route registration and the startup lines.
- `serve.ts` and `global-options.test.ts` are near #46's area. My changes there are just the `author` pass-through and one test.
- There is a stray untracked file named `download` at the repo root. It isn't mine and I left it alone.
