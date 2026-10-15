---
id: 73
title: Markdown headings and other prose elements render unstyled in the web UI
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T16:06:57.530Z'
createdBy: Justin Murray
updated: '2026-10-15T16:51:30.952Z'
---

Found while taking README screenshots. The editor/markdown views use Tailwind `prose` classes, but headings render like body text (`h2` computes to 16px, the same as `p`). `## Steps to reproduce` in a description looks like a plain paragraph. Likely cause: the `@tailwindcss/typography` plugin isn't installed or enabled for Tailwind v4, so `prose` has only partial custom rules.

## Acceptance criteria

- Headings (h1–h4), lists, blockquotes, code blocks, tables and horizontal rules are styled consistently in the editor, read-only markdown and comments, in both dark and light mode.
- Use `@tailwindcss/typography` (Tailwind v4 `@plugin`) or equivalent CSS. Keep the existing image sizing/lightbox styles working.
- UI build passes. The orchestrator will verify visually and refresh `docs/images/issue-detail.png`.

---

### Justin Murray — 2026-10-15T16:51:30.952Z

Markdown headings, lists, blockquotes, code blocks and rules are now styled in the web UI, in both dark and light mode. `./bun run check` passes, and so does `./bun run vite build --config vite.config.ts`.

**What was wrong**
All four markdown surfaces put `prose prose-sm dark:prose-invert` on their Tiptap root: the description editor (`IssueEditor`), the read-only `MarkdownContent`, and the comment view and editor (`CommentList`, `CommentEditor`). But `@tailwindcss/typography` wasn't installed or enabled, so those classes produced no CSS. Tailwind's base reset made every heading the same size as body text (`h2` was 16px). The only styling came from a few hand-written `.tiptap` rules for code, quotes, rules and lists.

**What changed**
- **Plugin:** added `@tailwindcss/typography` (`^0.5.20`) as a dev dependency and enabled it with `@plugin "@tailwindcss/typography";` in `globals.css`. With `prose-sm`, `h1`/`h2`/`h3` are now about 30/20/18px, `h4` is bold at body size, and lists, tables and links get proper spacing and colors.
- **Colors:** replaced the partial color overrides with a full set of `--tw-prose-*` variables for each theme. This keeps the UI's existing grays and blues and covers bullets, counters, quotes, rules, code blocks and table borders.
- **Inline code:** keeps its "chip" look. I turned off the plugin's backtick pseudo-content and bold weight.
- **Blockquotes:** turned off the plugin's curly quote marks and kept the existing border and tinted background.
- **Code blocks:** they keep their custom background, and the text color now comes from the matching theme variable. Without this, light mode would have shown light-gray text on a light background.
- **Lists:** I dropped the old hand-written list rules in favour of the plugin's, and kept items compact (Tiptap wraps each item's text in a `<p>`).
- **Images:** the existing sizing and lightbox styles are unchanged and still win.

These custom rules are not inside a CSS layer, so they always beat the plugin's rules without needing more specific selectors.

**Tests**
New `src/web/ui/styles/globals.test.ts` compiles `globals.css` the same way the Vite build does and checks that:
- headings get larger font sizes, and lists, quotes, code blocks, tables and rules get rules;
- `dark:prose-invert` switches to the dark palette;
- both themes define the full color set;
- the backticks and quote marks are suppressed;
- the image sizing and click-cursor styles are still there.

Three of the four tests fail against the old stylesheet. The image test passes either way, since it only guards against regressions.

I also checked by eye in a scratch repo, in both themes: `h2` is 20px bold, and the inline code, quote, code block, rule and nested lists look right.

**Files affected**
- `src/web/ui/styles/globals.css`
- `src/web/ui/styles/globals.test.ts` (new)
- `package.json` and `bun.lock`: two dev dependencies added, nothing else

**Decisions**
- I added `@tailwindcss/node` (`^4.2.2`) as an explicit dev dependency for the test. It was already installed as a pinned dependency of `@tailwindcss/vite`, so this adds no new code, but the test no longer relies on a package nobody declared.
- No changes to user docs; the only visible change is the styling.

**Follow-ups noticed**
- **Tables:** they will be styled if they ever render, but they don't today. Tiptap's StarterKit has no table support, so markdown tables in descriptions and comments don't show up as tables at all. Fixing that means adding Tiptap's table extension and checking that markdown round-trips cleanly, which is a separate issue.
- **Build warning:** the Vite build warns that a JavaScript chunk is over 500 kB. This change only touches CSS, so it isn't the cause.
- **Screenshot:** `docs/images/issue-detail.png` still needs refreshing, as planned.

**Orchestrator browser verification:** on the demo repo, `h2` in the description now computes to 20px (was 16px) with proper paragraph/list/code spacing; refreshed `docs/images/issue-detail.png` for the README.
