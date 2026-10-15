import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { needsSave } from './description-sync.ts';
import { getEditorMarkdown } from './markdown.ts';

/**
 * Regression test for #90: clicking into a description that ends in a code
 * block makes Tiptap append an empty trailing paragraph, which fires an
 * update (so the editor autosaves) without changing the markdown.
 */

// Tiptap needs a DOM (tiptap-markdown parses via DOMParser)
beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

/** An editor set up like IssueEditor, counting update events. */
function makeEditor(content: string): {
  editor: Editor;
  updates: () => number;
} {
  let updates = 0;
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
    ],
    content,
    onUpdate: () => {
      updates++;
    },
  });
  editors.push(editor);
  return { editor, updates: () => updates };
}

for (const text of [
  'Intro\n\n```js\nconst a = 1;\n```',
  'Intro\n\n> quoted',
  '* one\n* two',
]) {
  test(`clicking into ${JSON.stringify(text)} needs no save`, () => {
    const { editor, updates } = makeEditor(text);
    const loaded = { text, markdown: getEditorMarkdown(editor) };
    // A click: a selection change, on which Tiptap appends a trailing
    // paragraph after the final non-paragraph block
    editor.commands.focus('start');
    editor.commands.setTextSelection(1);
    expect(updates()).toBe(1);
    expect(editor.state.doc.lastChild?.type.name).toBe('paragraph');
    const markdown = getEditorMarkdown(editor);
    expect(needsSave(markdown, { version: '"v1"', text }, loaded)).toBe(false);

    // Typing into it is a real edit
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, 'More');
    expect(
      needsSave(getEditorMarkdown(editor), { version: '"v1"', text }, loaded),
    ).toBe(true);
  });
}
