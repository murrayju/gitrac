---
id: 116
title: fix padding in dropdown component
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-20T20:42:59.947Z'
createdBy: Justin Murray
updated: '2026-10-20T21:54:12.221Z'
---

The caret icon on the right is too close to the edge, it should have padding.

![image.png](/.issues/assets/_ZMnGqMGSPi9QDyWjL3IA.png)

---

### Justin Murray — 2026-10-20T21:54:11.817Z

\## Fix the caret padding in native `<select>` dropdowns

\### What was wrong
The browser draws its own caret on a native `<select>`, and padding doesn't move it. So in the issue list filters ("Open", "All priorities", "All assignees", and so on) and the "Acting as" picker, the caret sat against the right border. Those are the only two `<select>`s in the UI.

\### What changed
- **`src/web/ui/styles/globals.css`**: added one shared `.select-caret` class. It turns off the browser's caret (`appearance: none`), adds `2rem` of right padding, and draws a chevron as an inline SVG background placed `0.5rem` from the right edge. Dark mode gets a lighter chevron (gray-400; light mode uses gray-500). The class is in the components layer, so other utility classes on an element can still override it.
- **`src/web/ui/components/IssueList.tsx`** (`FilterSelect`) and **`IdentityPicker.tsx`**: added `select-caret` and changed `px-*` to `pl-*`. Otherwise `px-*` would replace the right padding and the text would run under the caret.
- **`AGENTS.md`**: added a one-line rule: new `<select>`s use `select-caret` and only `pl-*` padding.

Both are still native `<select>` elements, so keyboard and screen-reader behavior is unchanged.

\### Tests
Two new tests in `src/web/ui/styles/globals.test.ts` (both fail without the change):
1. The first builds the CSS with Tailwind, the same way as the existing prose tests. It checks that `.select-caret` turns off the native caret, has the right padding, and draws a background caret, and that the dark-mode rule has its own image.
2. The second scans every `src/web/ui/**/*.tsx` file and checks that every `<select>` has `select-caret` and no `px-*` or `pr-*` class (including variants like `dark:px-2`). This should keep the two dropdowns from drifting apart, and any new one has to follow the rule too.

Typecheck and lint pass with no errors or warnings, `./bun test src/web/` passes (478 tests), and the Vite build succeeds with the class in the built CSS.

\### Decisions and trade-offs
- I used a CSS class rather than a wrapper component with an icon. It's the smallest change, needs no extra markup, and keeps the native element as is.
- Each theme has its own caret rule with a fixed color, because a background SVG can't pick up the text color. The gray tones match the existing borders and text.
- The source-scan test only finds `<select>`s written as JSX with a plain string `className`. A `<select>` with a computed `className` would not be checked.

\### Follow-ups noticed
- `Dropdown.tsx` (the custom status/priority/assignee menus) is a button, not a `<select>`, and doesn't have this problem.
- The design spec and README don't describe how the dropdowns look, so I didn't change them.

**Orchestrator browser verification:** on a scratch repo, the issue list filters and the "Acting as" picker show the chevron inset from the right border in both dark and light mode; every `<select>` computes `appearance: none`, `padding-right: 32px` and the SVG background.
