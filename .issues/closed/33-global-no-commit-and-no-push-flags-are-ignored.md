---
id: 33
title: Global --no-commit and --no-push flags are ignored
status: done
priority: urgent
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:50:32.845Z'
---

Commander stores negated options under the positive name: `--no-commit` sets `opts().commit === false` and `--no-push` sets `opts().push === false`. Every command reads `globalOpts.noCommit` / `globalOpts.noPush`, which are never set.

As a result `gitrac close <id> --no-commit` still commits, which breaks the core "close the issue in the same commit as the fix" workflow documented in AGENTS.md and the skill. Project history shows this (e.g. `issue: close #32` committed separately before the feature commit).

`--no-push` only works by accident (`push: false` is passed through and `flags.push ?? autoPush` evaluates false).

## Repro

```bash
gitrac create -t First
gitrac close 1 --no-commit
git log --oneline   # shows "issue: close #1 First"
```

## Acceptance criteria

- `--no-commit` prevents commits for all mutating commands (create, edit, comment, close, reopen, claim, init)
- `--push` / `--no-push` behave per the spec (flag overrides `config.git.autoPush`)
- Option handling is centralized (one helper to read global opts) rather than repeated per command
- Tests that exercise the real Commander parsing (not just the helper functions)

---

### Justin Murray — 2026-10-14T21:50:32.845Z

\## Fix: global `--no-commit` / `--no-push` flags were ignored (#33)

**What was wrong**
Commander stores negated options under their positive name. `--no-commit` sets `opts().commit === false`, and `--push` / `--no-push` set `opts().push` to `true` / `false`. Every command read `globalOpts.noCommit` / `globalOpts.noPush`, and those are never set. So `--no-commit` did nothing, and `close <id> --no-commit` still committed. `--no-push` only worked by accident.

**What changed**
- **New `src/cli/global-options.ts`**, the one place global options are read:
  - `getGlobalOptions(program)` returns typed values: `dir`, `output`, `author`, `commit`, `push` and `port`. `commit` is false when `--no-commit` is passed. `push` is `true` / `false` / `undefined`, where `undefined` means "use `config.git.autoPush`".
  - `shouldCommit(opts, config)` is `opts.commit && config.git.autoCommit`.
  - `commitAndMaybePush(opts, config, files, message)` commits when allowed, then calls `pushIfConfigured` with `{ push: opts.push }`. It returns the commit hash, or null.
- **Commands updated:** `init`, `create`, `edit`, `comment`, `close`, `reopen` and `claim` now use `getGlobalOptions` and `commitAndMaybePush`. The copy-pasted `if (!globalOpts.noCommit && …) { commit; push }` blocks are gone. `list`, `show` and the web-server action in `src/cli/index.ts` also use `getGlobalOptions`, so the `|| process.cwd()`, `|| 'human'` and `parseInt(port)` fallbacks are no longer repeated in each file.
- **`init`** now honours `--no-commit`, and also `--push` (which it ignored before). It only prints "Committed initial configuration." when a commit actually happened.
- **Spec** (`docs/specs/2026-03-28-gitrac-design.md`): added a note under Global Flags:
  - global flags work before or after the subcommand;
  - `--no-commit` covers every mutating command and also stops the push;
  - if both `--push` and `--no-push` are given, the last one wins.

  AGENTS.md and the skill already describe the intended behaviour, so they are unchanged.

**Tests** (`src/cli/global-options.test.ts`, 27 tests, all using the real `createProgram()` and Commander parsing)
- **Parsing:** defaults, `--no-commit` before and after the subcommand, `--push`, `--no-push`, last-flag-wins, and `--dir` / `--author` / `-o` / `--port`.
- **End-to-end in scratch git repos:** each of the seven mutating commands creates no commit with `--no-commit` (and leaves the changes in the working tree), and does commit without it.
- **Push, against a bare remote:**
  - `autoPush` false, no flag: no push
  - `autoPush` false, `--push`: pushes
  - `autoPush` true, no flag: pushes
  - `autoPush` true, `--no-push`: commits locally but doesn't push
  - `--push --no-commit`: no commit and no push
- **Regression check:** with the old `noCommit` lookup put back temporarily, 11 tests fail (the parsing tests and every `--no-commit` end-to-end test). They pass with the fix. `./bun run check` passes (245 tests).

**Decisions / trade-offs**
- I kept `noPush` in `pushIfConfigured`'s signature so its existing tests and any outside callers keep working. The CLI now only passes `push`.
- Push still only happens after an auto-commit, as before. `--no-commit --push` does nothing.
- `init` keeps its existing `try/catch`, which silently swallows config, commit and push errors. I didn't change that.

**Related issues I noticed**
- **#37:** the global `-p, --port` takes `create -p` even after the subcommand, for the same reason global flags are parsed anywhere. The new tests avoid `-p`.
- **#35:** `commitAndMaybePush` is now the single place CLI commits happen, so a fix that commits only the listed paths can go there.
- **#40:** `getGlobalOptions().dir` is the obvious place to resolve the git root instead of using `cwd`.
- **#51 and #46:** this removes part of the CLI duplication; the web routes still call commit and push separately, and exit-code handling is unchanged.
