---
id: 60
title: Config YAML is parsed with js-yaml 3 unsafe load()
status: done
priority: high
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T23:05:03.596Z'
createdBy: Justin Murray
updated: '2026-10-14T23:26:33.658Z'
---

`src/core/config.ts` and `src/cli/output.ts` import `js-yaml`, which is not a direct dependency — it resolves to gray-matter's transitive js-yaml **3.14**. In js-yaml 3.x, `yaml.load()` uses `DEFAULT_FULL_SCHEMA`, which supports `!!js/function`, `!!js/regexp` and `!!js/undefined`. A crafted `.issues/config.yaml` (e.g. from a malicious PR or clone) can thus inject JavaScript functions into the parsed config.

(Found while fixing #44; `parseIssue` now uses `CORE_SCHEMA`.)

## Acceptance criteria

- Add `js-yaml` as a direct dependency (pin a version; consider v4 where `load` is safe by default — check API differences like `safeLoad` removal and `dump` options).
- `parseConfig` uses a safe schema (`CORE_SCHEMA`/`FAILSAFE`-based, no js types); keep timestamps out of config too.
- Update `src/js-yaml.d.ts` accordingly (or use `@types/js-yaml`).
- Test that `!!js/function` in config is rejected (or parsed as a plain string) and never yields a function.

---

### Justin Murray — 2026-10-14T23:26:33.658Z

**Problem**

`src/core/config.ts` and `src/cli/output.ts` imported `js-yaml`, but it wasn't a direct dependency. It resolved to gray-matter's js-yaml **3.14**, where `yaml.load()` uses `DEFAULT_FULL_SCHEMA`. A crafted `.issues/config.yaml` could therefore put `!!js/function`, `!!js/regexp` or `!!js/undefined` values into the parsed config. Any key the validator doesn't check (e.g. `evil: !!js/function …`) got through. Timestamps were also parsed into `Date` objects. Also, `serializeConfig` passed `quotingType: '"'` and `forceQuotes`, which are v4-only options that v3 silently ignored. Upgrading js-yaml without touching them would have changed `config.yaml` from `'#e05d5d'` to `"#e05d5d"`.

**Changes**

- **`package.json` / `bun.lock`:** `js-yaml` is now a direct dependency, pinned exactly to **4.3.2** (newest 4.x). In v4, `load` never builds `!!js/*` types, and 4.3 also adds `maxDepth` and merge-key limits. gray-matter keeps its own nested js-yaml 3.14 (`gray-matter/js-yaml` in the lockfile).
- **`src/core/config.ts`:**
  - `parseConfig` now loads with `CORE_SCHEMA`. That rejects `!!js/*`, `!!timestamp`, `!!binary`, `!!set` and `!!omap`, and keeps date-like values as strings.
  - `serializeConfig` now calls `yaml.dump(config, { lineWidth: -1 })`. Dropping the v4-only quoting options keeps the existing single-quote output. It still dumps with the default schema, so strings like `2026-03-28` and `yes` stay quoted.
- **`src/js-yaml.d.ts`:** documented as v4 types, and the unused `quotingType`/`forceQuotes` options are removed. `issue.ts` keeps using `CORE_SCHEMA` and works unchanged.
- **`src/core/config.test.ts`:** new regression tests:
  - `!!js/function` (in an extra key and in a known field), `!!js/regexp`, `!!js/undefined`, `!!binary`, `!!set` and `!!timestamp` are rejected, and the result never contains functions, regexps, Dates or undefined.
  - Timestamp-like values stay strings.
  - A `__proto__` key doesn't pollute `Object.prototype`.
  - A golden-output test for `serializeConfig`.
  - This repo's `.issues/config.yaml` round-trips byte-for-byte.

  Against the original `config.ts`, 7 of these fail with js-yaml 3 and 6 fail with js-yaml 4.
- **`docs/specs/2026-03-28-gitrac-design.md`:** one sentence on how `config.yaml` is parsed.

**Byte-identical check**

`.issues/config.yaml` and all 60 issue files in this repo come out exactly as they went in. Issue files are written by gray-matter, which still uses its own js-yaml 3, so they can't change. `./bun run check` passes (501 tests).

**Decisions and trade-offs**

- **Not js-yaml 5.x (current `latest`):** it's a rewrite with no default export and different dump options. v4 is the standard upgrade path.
- **Kept the local `.d.ts`** instead of adding `@types/js-yaml`, so there's no extra dependency and no clash with the module declaration.
- **`-o yaml` output changes slightly.** v4 quotes fewer strings, e.g. `title: Issue drafts, modal close confirmation` no longer has quotes. It's still valid YAML that parses to the same values, but scripts that compare the text exactly would see a difference.

**Follow-ups (not fixed here)**

- A bad `config.yaml` (now including a rejected `!!js/*` tag, and before this any YAML syntax or validation error) crashes the CLI with a raw `YAMLException` and stack dump instead of a clean `Error: …` and exit 1. This was already the case before this change; it might be worth its own issue.
- Anything that changes `bun.lock`/`package.json` at the same time will need a merge.
