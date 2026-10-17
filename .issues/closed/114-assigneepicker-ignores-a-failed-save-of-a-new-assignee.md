---
id: 114
title: AssigneePicker ignores a failed save of a new assignee
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-17T13:46:17.070Z'
createdBy: Justin Murray
updated: '2026-10-17T13:47:34.116Z'
---

Found by #109. `handleCreate` in `src/web/ui/components/AssigneePicker.tsx` swallows an `updateAssignees` failure (e.g. the 400 for a name with an em dash, added in #109) and still sets the new email as the assignee. The user gets no feedback, and the issue gets an assignee that is not in the config.

## Acceptance criteria

- On failure, show the server's message inline in the new-assignee form, keep the form open with the typed values, and do not change the issue's assignee.

---

### Justin Murray — 2026-10-17T13:47:33.687Z

**What was wrong:** `handleCreate` in `src/web/ui/components/AssigneePicker.tsx` swallowed an `updateAssignees` failure and still set the new email as the assignee. Since #109 rejects names and emails with a line break or an em dash, that path was easy to hit: no feedback, and the issue got an assignee that was not in the config.

**What changed:** on failure the new-assignee form stays open with the typed values and shows the server's message (`requestErrorReason`) in a `role="alert"` line; the issue's assignee is not changed. The error clears when the form opens again or the save succeeds.

**Verification:** browser check on a scratch repo: creating assignee `Ada — L` showed `Invalid assignee name "Ada — L": must not contain the em dash (U+2014)` in the form; the issue stayed unassigned and `config.yaml` was unchanged. Typecheck, lint and the Vite build pass. No unit test: the change is UI wiring around the existing, tested `requestErrorReason`.
