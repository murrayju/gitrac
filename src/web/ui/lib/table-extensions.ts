/**
 * GFM tables in the Tiptap editors (#89).
 *
 * markdown-it (inside tiptap-markdown) already parses GFM tables to HTML;
 * these extensions give the editor schema table nodes to hold them, keep each
 * column's alignment, and serialize tables back to GFM. tiptap-markdown's own
 * table serializer drops alignment, doesn't escape `|` inside cells (so a
 * cell containing `a \| b` comes back as two cells), and writes a table it
 * can't express in GFM (no header row, merged cells, a cell with several
 * paragraphs or a hard break, all reachable by editing) as the literal text
 * `[table]` when `html` is off. This one always writes a GFM table: it may
 * flatten such a table, but never loses its text.
 */

import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from '@tiptap/extension-table';
import type { Node as PMNode } from '@tiptap/pm/model';

export type CellAlign = 'left' | 'center' | 'right';

/** A column alignment from a `text-align` value (markdown-it's `style`). */
export function parseCellAlign(
  value: string | null | undefined,
): CellAlign | null {
  const align = value?.trim().toLowerCase();
  return align === 'left' || align === 'center' || align === 'right'
    ? align
    : null;
}

/** The GFM delimiter-row cell for a column alignment. */
export function delimiterCell(align: CellAlign | null): string {
  switch (align) {
    case 'left':
      return ':---';
    case 'center':
      return ':---:';
    case 'right':
      return '---:';
    default:
      return '---';
  }
}

/**
 * Escape a cell's rendered markdown for a GFM row: one line, `|` escaped.
 * GFM splits a row on unescaped pipes before any inline parsing, and then
 * drops the backslash of every `\|` (even in code spans and link targets),
 * so escaping every pipe is right everywhere in a cell.
 */
export function escapeCellMarkdown(markdown: string): string {
  return markdown
    .replace(/\s*\n\s*/g, ' ')
    .trim()
    .replace(/\|/g, '\\|');
}

type NodeSerializer = (
  state: SerializerState,
  node: PMNode,
  parent: PMNode,
  index: number,
) => void;

/**
 * The parts of tiptap-markdown's serializer state (a prosemirror-markdown
 * `MarkdownSerializerState`) used here; `out` is internal there, so untyped.
 */
interface SerializerState {
  out: string;
  inTable?: boolean;
  nodes: Record<string, NodeSerializer>;
  marks: unknown;
  options: unknown;
  write(content?: string): void;
  ensureNewLine(): void;
  closeBlock(node: PMNode): void;
  renderInline(parent: PMNode, fromBlockStart?: boolean): void;
  renderContent(parent: PMNode): void;
}

type SerializerStateClass = new (
  nodes: SerializerState['nodes'],
  marks: SerializerState['marks'],
  options: SerializerState['options'],
) => SerializerState;

/**
 * Render a cell's content as one line of inline markdown, in a fresh
 * serializer state (so its blocks' separators and pending mark bookkeeping
 * stay out of the table's output). A paragraph is rendered without
 * start-of-line escaping (`- x` is plain text in a cell) and a hard break
 * becomes a space (GFM has no line breaks in cells without HTML).
 */
function renderCell(state: SerializerState, cell: PMNode | undefined): string {
  if (!cell) return '';
  const Ctor = state.constructor as SerializerStateClass;
  const sub = new Ctor(
    {
      ...state.nodes,
      paragraph: (s, node) => {
        s.renderInline(node, false);
        s.closeBlock(node);
      },
      hardBreak: (s) => s.write(' '),
    },
    state.marks,
    state.options,
  );
  sub.inTable = true;
  sub.renderContent(cell);
  return escapeCellMarkdown(sub.out);
}

/** Serialize a table node as a GFM table (the first row is the header). */
export function serializeTable(state: SerializerState, node: PMNode): void {
  // Cells per row, a merged cell padded out with empty ones to its colspan
  const rows: (PMNode | undefined)[][] = [];
  node.forEach((row) => {
    const cells: (PMNode | undefined)[] = [];
    row.forEach((cell) => {
      cells.push(cell);
      const colspan = Number(cell.attrs.colspan) || 1;
      for (let i = 1; i < colspan; i++) cells.push(undefined);
    });
    rows.push(cells);
  });
  const width = Math.max(1, ...rows.map((cells) => cells.length));
  const header = rows[0] ?? [];
  const aligns = Array.from({ length: width }, (_, i) =>
    parseCellAlign(header[i]?.attrs.align),
  );

  const writeRow = (cells: string[]) => {
    state.write(`| ${cells.join(' | ')} |`);
    state.ensureNewLine();
  };
  rows.forEach((cells, i) => {
    writeRow(
      Array.from({ length: width }, (_, j) => renderCell(state, cells[j])),
    );
    if (i === 0) writeRow(aligns.map(delimiterCell));
  });
  state.closeBlock(node);
}

/** A cell's column alignment, as markdown-it writes it (`text-align`). */
const alignAttribute = {
  align: {
    default: null,
    parseHTML: (element: HTMLElement) =>
      parseCellAlign(element.style.textAlign || element.getAttribute('align')),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.align ? { style: `text-align: ${attributes.align}` } : {},
  },
};

const GfmTable = Table.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize: serializeTable,
        parse: {
          // markdown-it parses GFM tables
        },
      },
    };
  },
});

const GfmTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttribute };
  },
});

const GfmTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttribute };
  },
});

/** The table extensions every markdown editor/viewer adds to StarterKit. */
export const tableExtensions = [
  GfmTable,
  TableRow,
  GfmTableHeader,
  GfmTableCell,
];
