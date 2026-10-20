import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { compile, optimize } from '@tailwindcss/node';

const cssPath = join(import.meta.dir, 'globals.css');

/** Compile globals.css as the Vite plugin does, for the given class candidates. */
async function buildCss(candidates: string[]): Promise<string> {
  const source = await Bun.file(cssPath).text();
  const compiler = await compile(source, {
    base: dirname(cssPath),
    onDependency: () => {},
  });
  // Flatten nesting (as the production build does) so selectors are greppable.
  return optimize(compiler.build(candidates)).code;
}

/** The declarations of the first rule whose selector contains `selector`. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) return '';
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

// Every markdown surface (description editor, MarkdownContent, comment view +
// editor) uses these classes on its Tiptap root.
const PROSE_CLASSES = ['prose', 'prose-sm', 'max-w-none', 'dark:prose-invert'];

describe('globals.css prose styling', () => {
  test('prose classes generate element styles (typography plugin is loaded)', async () => {
    const css = await buildCss(PROSE_CLASSES);
    // Headings must be larger than body text (h2 was 16px, same as <p>).
    for (const tag of ['h1', 'h2', 'h3']) {
      expect(ruleBody(css, `.prose-sm :where(${tag})`)).toMatch(
        /font-size:\s*1\.\d+em|font-size:\s*2\.\d+em/,
      );
    }
    for (const el of ['ul', 'ol', 'blockquote', 'pre', 'table', 'hr']) {
      expect(css).toContain(`.prose-sm :where(${el})`);
    }
    // dark:prose-invert must resolve to the invert palette under .dark.
    expect(css).toContain('--tw-prose-body: var(--tw-prose-invert-body)');
  });

  test('custom overrides set a full palette for both themes', async () => {
    const css = await buildCss(PROSE_CLASSES);
    const light = ruleBody(css, '.tiptap.prose {');
    const dark = ruleBody(css, '.dark .tiptap.prose {');
    for (const name of [
      'body',
      'headings',
      'links',
      'bullets',
      'counters',
      'hr',
      'quotes',
      'quote-borders',
      'code',
      'pre-code',
      'pre-bg',
      'th-borders',
      'td-borders',
    ]) {
      expect(light).toContain(`--tw-prose-${name}:`);
      expect(dark).toContain(`--tw-prose-${name}:`);
    }
  });

  test('inline code and blockquotes drop the plugin’s generated quote marks', async () => {
    const css = await buildCss(PROSE_CLASSES);
    // (the optimizer writes `::before` as `:before`)
    expect(ruleBody(css, '.tiptap code:before')).toContain('content: none');
    expect(ruleBody(css, '.tiptap blockquote p:before')).toContain(
      'content: none',
    );
  });

  test('image sizing / lightbox cursor styles are kept', async () => {
    const css = await buildCss(PROSE_CLASSES);
    const img = ruleBody(css, '.tiptap img {');
    expect(img).toContain('max-height: 400px');
    expect(img).toContain('cursor: pointer');
  });

  test('table header cells get thead styling (Tiptap puts them in tbody)', async () => {
    const css = await buildCss(PROSE_CLASSES);
    // The plugin only styles `thead th`, which Tiptap never renders
    expect(css).toContain('.prose :where(thead th)');
    const th = ruleBody(css, '.tiptap.prose th {');
    expect(th).toContain('font-weight: 600');
    expect(th).toContain('color: var(--tw-prose-headings)');
    expect(ruleBody(css, '.tiptap.prose tr:has(')).toContain(
      'border-bottom-color: var(--tw-prose-th-borders)',
    );
    expect(ruleBody(css, '.tiptap.prose :is(th, td) > p')).toContain(
      'margin-top: 0',
    );
  });
});

describe('globals.css select-caret (#116)', () => {
  test('drops the native caret and pads a drawn one away from the edge', async () => {
    const css = await buildCss(['select-caret']);
    const rule = ruleBody(css, '.select-caret {');
    expect(rule).toContain('appearance: none');
    expect(rule).toMatch(/padding-right:\s*2rem/);
    expect(rule).toContain('background-image: url("data:image/svg+xml');
    expect(rule).toMatch(/background-position:\s*right \.5rem center/);
    expect(rule).toContain('background-repeat: no-repeat');
    // The dark theme gets its own (lighter) caret color.
    const dark = ruleBody(css, '.dark .select-caret {');
    expect(dark).toContain('background-image: url("data:image/svg+xml');
    expect(dark).not.toEqual(rule);
  });

  test('every <select> in the UI uses it, without a px-*/pr-* that resets the right padding', async () => {
    const uiDir = join(import.meta.dir, '..');
    let count = 0;
    for await (const file of new Bun.Glob('**/*.tsx').scan(uiDir)) {
      const source = await Bun.file(join(uiDir, file)).text();
      for (const m of source.matchAll(
        /<select\b[\s\S]*?className="([^"]*)"/g,
      )) {
        count++;
        const classes = (m[1] ?? '').split(/\s+/);
        expect({ file, classes }).toMatchObject({
          file,
          classes: expect.arrayContaining(['select-caret']),
        });
        expect(classes.filter((c) => /^(?:\w+:)*p[xr]-/.test(c))).toEqual([]);
      }
    }
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
