---
id: 111
title: Claimed-elsewhere badge ignores the review status and stale claims
status: backlog
priority: low
assignee: ''
labels:
  - enhancement
created: '2026-10-16T21:58:38.249Z'
createdBy: Justin Murray
updated: '2026-10-16T21:58:38.249Z'
---

Follow-ups from #105 and #106:

- `ClaimedElsewhereBadge` always uses the active status's colors. A claim that is in the review status elsewhere looks the same as active work. `ClaimedElsewhere` doesn't carry the status today.
- The web UI has no stale-claim indicator, and there is no way to renew a claim or release a stale one from the web (the new claim/unclaim routes from #103 could take `renew` / `stale`).

## Acceptance criteria

- `claimedElsewhere` includes the status (additive field), and the badge uses that status's style and label.
- `POST /api/issues/:id/claim` accepts `renew`, `/unclaim` accepts `stale`; the UI marks stale claims (with a configured or entered threshold) and offers "Release stale claim".
- Consider an optional `staleAfter` default in `config.yaml` so `--stale` need not be passed on every call.
- Tests.
