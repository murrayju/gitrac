import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { Editor, type Extension } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { ISSUE_REF_ATTR, IssueLinks } from './issue-link-plugin.ts';
import { clearIssueTitles, rememberIssueTitles } from './issue-titles.ts';
import { getEditorMarkdown } from './markdown.ts';

// Tiptap needs a DOM (tiptap-markdown parses via DOMParser)
beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  clearIssueTitles();
});

/** An editor set up like the app's (IssueEditor / MarkdownContent). */
function makeEditor(
  content: string,
  extra: Extension[] = [],
  editable = true,
): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: false }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      ...extra,
    ],
    content,
    editable,
  });
  editors.push(editor);
  return editor;
}

function refLinks(editor: Editor): HTMLAnchorElement[] {
  return [
    ...editor.view.dom.querySelectorAll<HTMLAnchorElement>(
      `a[${ISSUE_REF_ATTR}]`,
    ),
  ];
}

const SAMPLE = [
  'Fixes #3, see also (#12).',
  '',
  '## Follow-up for #5',
  '',
  'Inline `#4` code, a [link to #7](https://example.com) and https://example.com/page#8.',
  '',
  '```',
  '#6 in a code block',
  '```',
  '',
  '- list item #9',
  '- not abc#10 or #11-setup',
  '',
  '> quoted **#13** ref',
].join('\n');

describe('IssueLinks', () => {
  test('links #N in text, headings, lists and quotes only', () => {
    const editor = makeEditor(SAMPLE, [IssueLinks]);
    const links = refLinks(editor);
    expect(links.map((a) => a.textContent)).toEqual([
      '#3',
      '#12',
      '#5',
      '#9',
      '#13',
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/issues/3',
      '/issues/12',
      '/issues/5',
      '/issues/9',
      '/issues/13',
    ]);
  });

  test('does not change the saved markdown', () => {
    const plain = makeEditor(SAMPLE);
    const linked = makeEditor(SAMPLE, [IssueLinks]);
    expect(refLinks(linked).length).toBeGreaterThan(0);
    expect(getEditorMarkdown(linked)).toBe(getEditorMarkdown(plain));
    expect(linked.getJSON()).toEqual(plain.getJSON());

    // A simple document round-trips exactly
    const simple = 'Blocked by #3 and #4.\n\nSee #5';
    expect(getEditorMarkdown(makeEditor(simple, [IssueLinks]))).toBe(simple);
  });

  test('a title refresh neither changes the markdown nor counts as an edit', () => {
    // Ends in a code block: any transaction makes StarterKit append a
    // trailing paragraph, which must not surface as an `update` (autosave)
    const editor = makeEditor('Blocked by #3\n\n```\ncode\n```', [IssueLinks]);
    const before = getEditorMarkdown(editor);
    let updates = 0;
    editor.on('update', () => {
      updates++;
    });
    rememberIssueTitles([{ id: 3, title: 'Fix login timeout' }]);
    expect(refLinks(editor)[0]?.getAttribute('title')).toBe(
      'Fix login timeout',
    );
    expect(updates).toBe(0);
    expect(getEditorMarkdown(editor)).toBe(before);
    expect(editor.can().undo()).toBe(false);
  });

  test('shows a known title at render time', () => {
    rememberIssueTitles([{ id: 7, title: 'Known' }]);
    const editor = makeEditor('#7 and #8', [IssueLinks], false);
    expect(refLinks(editor).map((a) => a.getAttribute('title'))).toEqual([
      'Known',
      null,
    ]);
  });

  test('follows edits', () => {
    const editor = makeEditor('Hello', [IssueLinks]);
    expect(refLinks(editor)).toEqual([]);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' #21');
    expect(refLinks(editor).map((a) => a.textContent)).toEqual(['#21']);
    expect(getEditorMarkdown(editor)).toBe('Hello #21');
  });

  test('a click navigates in-app when given navigate', () => {
    const paths: string[] = [];
    const editor = makeEditor(
      'See #3',
      [IssueLinks.configure({ navigate: (p) => paths.push(p) })],
      false,
    );
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    refLinks(editor)[0]?.dispatchEvent(event);
    expect(paths).toEqual(['/issues/3']);
    expect(event.defaultPrevented).toBe(true);
  });

  test('a modified click in a read-only view is left to the browser', () => {
    const paths: string[] = [];
    const editor = makeEditor(
      'See #3',
      [IssueLinks.configure({ navigate: (p) => paths.push(p) })],
      false,
    );
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    refLinks(editor)[0]?.dispatchEvent(event);
    expect(paths).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  test('without navigate, a click opens a new tab', () => {
    const opened: unknown[][] = [];
    const original = window.open;
    window.open = ((...args: unknown[]) => {
      opened.push(args);
      return null;
    }) as typeof window.open;
    try {
      const editor = makeEditor('See #3', [IssueLinks]);
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });
      refLinks(editor)[0]?.dispatchEvent(event);
      expect(opened).toEqual([['/issues/3', '_blank', 'noopener']]);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      window.open = original;
    }
  });
});
