import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { needsSave } from './description-sync.ts';
import { getEditorMarkdown } from './markdown.ts';
import {
  delimiterCell,
  escapeCellMarkdown,
  parseCellAlign,
  tableExtensions,
} from './table-extensions.ts';

// Tiptap needs a DOM (tiptap-markdown parses via DOMParser)
beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

/** An editor set up like IssueEditor / MarkdownContent. */
function makeEditor(content: string, editable = true): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: false }),
      ...tableExtensions,
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content,
    editable,
  });
  editors.push(editor);
  return editor;
}

/** Document position just inside the text of the first cell containing `text`. */
function posInCell(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.isText && node.text?.includes(text)) {
      found = pos + node.text.indexOf(text) + text.length;
      return false;
    }
    return true;
  });
  if (found === -1) throw new Error(`no text ${text}`);
  return found;
}

function setCursor(editor: Editor, pos: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
}

const TABLE = [
  '| Name | Align | Count | Notes |',
  '| :--- | :---: | ---: | --- |',
  '| `parse()` | [docs](https://example.com/a_b) | 42 | **bold** and *it* |',
  '| a \\| b | `x \\| y` |  | see #12 |',
].join('\n');

describe('helpers', () => {
  test('parseCellAlign accepts only GFM alignments', () => {
    expect(parseCellAlign('center')).toBe('center');
    expect(parseCellAlign(' Right ')).toBe('right');
    expect(parseCellAlign('left')).toBe('left');
    expect(parseCellAlign('justify')).toBeNull();
    expect(parseCellAlign('')).toBeNull();
    expect(parseCellAlign(null)).toBeNull();
  });

  test('delimiterCell writes each alignment', () => {
    expect(
      [null, 'left', 'center', 'right'].map((a) => delimiterCell(a as never)),
    ).toEqual(['---', ':---', ':---:', '---:']);
  });

  test('escapeCellMarkdown keeps a cell on one line with pipes escaped', () => {
    expect(escapeCellMarkdown('a | b')).toBe('a \\| b');
    expect(escapeCellMarkdown('one\n\ntwo\n')).toBe('one two');
    expect(escapeCellMarkdown('  x  ')).toBe('x');
  });
});

describe('GFM tables in the editor (#89)', () => {
  test('a table renders as a table, with header cells and alignment', () => {
    const html = makeEditor(TABLE, false).getHTML();
    expect(html).toContain('<table');
    expect(html.match(/<th\b/g)?.length).toBe(4);
    expect(html.match(/<td\b/g)?.length).toBe(8);
    expect(html).toContain('style="text-align: center;"');
    expect(html).toContain('style="text-align: right;"');
    expect(html).toContain('<code>parse()</code>');
    expect(html).toContain('href="https://example.com/a_b"');
    expect(html).toContain('a | b');
    expect(html).toContain('<code>x | y</code>');
  });

  test('a typical GFM table round-trips exactly', () => {
    for (const markdown of [
      TABLE,
      `Intro text\n\n${TABLE}\n\nAfter the table`,
      `- item\n\n  | A | B |\n  | --- | --- |\n  | 1 | 2 |`,
      `> | Quoted |\n> | --- |\n> | cell |`,
      '| Shot |\n| --- |\n| ![alt](/assets/x.png) |',
    ]) {
      expect(getEditorMarkdown(makeEditor(markdown)).trim()).toBe(markdown);
    }
  });

  test('other table spellings are normalized, not mangled', () => {
    const editor = makeEditor('|A|B|\n|-|:-:|\n|1|2|\n|3|');
    expect(getEditorMarkdown(editor).trim()).toBe(
      '| A | B |\n| --- | :---: |\n| 1 | 2 |\n| 3 |  |',
    );
  });

  test('opening and clicking around a table never saves', () => {
    const cases: [text: string, cell: string][] = [
      [TABLE, 'Count'],
      [`Intro\n\n${TABLE}`, 'Count'],
      ['|A|B|\n|-|:-:|\n|1|2|', 'B'], // normalized on load: still not saved
    ];
    for (const [text, cell] of cases) {
      const editor = makeEditor(text);
      const loaded = { text, markdown: getEditorMarkdown(editor) };
      const base = { version: '"v1"', text };
      // Clicks: into a cell, then after the table (Tiptap appends a
      // trailing paragraph after a final table)
      editor.commands.focus();
      setCursor(editor, posInCell(editor, cell));
      editor.commands.focus('end');
      expect(editor.state.doc.lastChild?.type.name).toBe('paragraph');
      expect(needsSave(getEditorMarkdown(editor), base, loaded)).toBe(false);

      // Typing into a cell is a real edit, saved as a GFM table
      editor.commands.insertContentAt(posInCell(editor, cell), 'X');
      const edited = getEditorMarkdown(editor);
      expect(needsSave(edited, base, loaded)).toBe(true);
      expect(edited).toContain(`| ${cell}X |`);
    }
  });

  test('edited tables GFM cannot express are flattened, keeping their text', () => {
    const editor = makeEditor(
      '| A | B |\n| --- | --- |\n| one | two |\n| three | four |',
    );
    // Shift-Enter and Enter inside a cell
    setCursor(editor, posInCell(editor, 'one'));
    editor.commands.setHardBreak();
    editor.commands.insertContent('line');
    setCursor(editor, posInCell(editor, 'two'));
    editor.commands.splitBlock();
    editor.commands.insertContent('para');
    expect(getEditorMarkdown(editor).trim()).toBe(
      '| A | B |\n| --- | --- |\n| one line | two para |\n| three | four |',
    );

    // Merged cells
    setCursor(editor, posInCell(editor, 'three'));
    editor.commands.setCellSelection({
      anchorCell: posInCell(editor, 'three') - 'three'.length - 2,
      headCell: posInCell(editor, 'four') - 'four'.length - 2,
    });
    expect(editor.commands.mergeCells()).toBe(true);
    const merged = getEditorMarkdown(editor).trim();
    expect(merged).not.toContain('[table]');
    expect(merged.split('\n')[3]).toBe('| three four |  |');

    // No header row
    setCursor(editor, posInCell(editor, 'A'));
    expect(editor.commands.toggleHeaderRow()).toBe(true);
    const headerless = getEditorMarkdown(editor).trim();
    expect(headerless.split('\n').slice(0, 2)).toEqual([
      '| A | B |',
      '| --- | --- |',
    ]);
    expect(headerless).not.toContain('[table]');
  });
});
