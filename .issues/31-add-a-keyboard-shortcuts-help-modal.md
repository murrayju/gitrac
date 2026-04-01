---
id: 31
title: Add a keyboard shortcuts help modal
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-04-01T17:25:25.074Z'
createdBy: web
updated: '2026-04-01T18:26:45.795Z'
---

Open with `cmd+/`, style like Linear

![image.png](/.issues/assets/aEBNyeXRzD2fnSMrs2weK.png)

---

### Justin Murray — 2026-04-01T18:26:45.795Z

Added a keyboard shortcuts help modal, styled like Linear.

**Changes:**
- Created src/web/ui/components/ShortcutsModal.tsx — Linear-inspired modal showing all keyboard shortcuts in organized sections (General + Editors). Features platform-aware modifier key labels (Cmd on Mac, Ctrl on others), styled kbd elements, backdrop blur, close on Escape/backdrop click.
- Updated src/web/ui/components/Layout.tsx — Added Cmd+/ and ? global hotkeys to toggle the shortcuts modal, added a '? Shortcuts' button in the sidebar footer, refactored global hotkey handler to support multiple shortcuts.

Shortcuts documented: ? (show shortcuts), c (create issue), Cmd+Enter (submit), Escape (close).
