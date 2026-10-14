---
id: 60
title: Config YAML is parsed with js-yaml 3 unsafe load()
status: todo
priority: high
assignee: ''
labels:
  - bug
created: '2026-10-14T23:05:03.596Z'
createdBy: Justin Murray
updated: '2026-10-14T23:05:03.596Z'
---

`src/core/config.ts` and `src/cli/output.ts` import `js-yaml`, which is not a direct dependency — it resolves to gray-matter's transitive js-yaml **3.14**. In js-yaml 3.x, `yaml.load()` uses `DEFAULT_FULL_SCHEMA`, which supports `!!js/function`, `!!js/regexp` and `!!js/undefined`. A crafted `.issues/config.yaml` (e.g. from a malicious PR or clone) can thus inject JavaScript functions into the parsed config.

(Found while fixing #44; `parseIssue` now uses `CORE_SCHEMA`.)

## Acceptance criteria

- Add `js-yaml` as a direct dependency (pin a version; consider v4 where `load` is safe by default — check API differences like `safeLoad` removal and `dump` options).
- `parseConfig` uses a safe schema (`CORE_SCHEMA`/`FAILSAFE`-based, no js types); keep timestamps out of config too.
- Update `src/js-yaml.d.ts` accordingly (or use `@types/js-yaml`).
- Test that `!!js/function` in config is rejected (or parsed as a plain string) and never yields a function.
