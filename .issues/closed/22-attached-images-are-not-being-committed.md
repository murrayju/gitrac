---
id: 22
title: Attached images are not being committed
status: done
priority: medium
assignee: Justin Murray
labels:
  - bug
created: '2026-03-30T00:39:45.579Z'
createdBy: web
updated: '2026-03-30T01:33:06.655Z'
---

Pretty sure this was working previously. I just created a few tickets with images pasted in the description. The images were correctly attached (render in the ticket, and the files were created in the correct location), but they were not included in the commit for the new issue. Instead, they are left as orphaned, untracked files

![image.png](/.issues/assets/erK6448tbTkMl6FwN4xcM.png)

---

### Justin Murray — 2026-03-30T01:32:59.027Z

Fixed attached images not being committed to git by including referenced asset files in the git commit.

Root cause: Image uploads (POST /api/issues/assets) write files to .issues/assets/ but are decoupled from issue save routes. The commit only staged the .md file and config.yaml, never the asset files.

Fix:
- Created src/core/assets.ts with extractAssetRefs() — pure function that scans markdown for /.issues/assets/<filename> patterns and returns unique filenames
- Added src/core/assets.test.ts with 4 tests (image refs, no refs, deduplication, inline refs)
- Added referencedAssetPaths() helper in src/web/routes/issues.ts that maps issue description + comment bodies into .issues/assets/ paths
- Updated all commit points in issues.ts to include asset paths: create, update, add comment, edit comment, close, and reopen routes

Files affected: src/core/assets.ts (new), src/core/assets.test.ts (new), src/web/routes/issues.ts
