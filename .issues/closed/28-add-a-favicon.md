---
id: 28
title: Add a favicon
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-04-01T17:11:16.158Z'
createdBy: web
updated: '2026-04-01T17:58:25.862Z'
---

The favicon is currently unset. Generate an interesting on-brand icon to use as a placeholder for now, and configure it.

---

### Justin Murray — 2026-04-01T17:58:22.478Z

Added an SVG favicon for the gitrac web UI.

**Changes:**
- Created src/web/ui/public/favicon.svg — an SVG icon with indigo/purple gradient background, white git branch/node symbols, and a green checkmark representing issue tracking
- Updated src/web/ui/index.html — added favicon link tag

The favicon is served via Vite's public directory mechanism and will be included in production builds automatically.
